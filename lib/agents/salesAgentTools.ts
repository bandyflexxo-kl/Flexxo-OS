/**
 * lib/agents/salesAgentTools.ts
 * Tool implementations for the Sales AI Agent.
 * All tools are read-only DB queries — never write.
 */
import { prisma } from '@/lib/prisma'

export type ToolResult = Record<string, unknown>

function displayPrice(qneLastSalePrice: { toNumber: () => number } | null): string | null {
  if (!qneLastSalePrice) return null
  return (qneLastSalePrice.toNumber() * 1.2).toFixed(2)
}

// ── search_products ─────────────────────────────────────────────────────────

export async function searchProducts(query: string, limit = 10): Promise<ToolResult> {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { brand: { contains: query, mode: 'insensitive' } },
        { qneItemCode: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: {
      category: { include: { parentCategory: true } },
      _count: { select: { quotationItems: true } },
    },
    orderBy: { quotationItems: { _count: 'desc' } },
    take: limit,
  })

  if (products.length === 0) {
    return { found: false, message: `No products found matching "${query}". Try a different keyword or brand name.` }
  }

  return {
    found: true,
    count: products.length,
    products: products.map(p => ({
      itemCode:     p.qneItemCode ?? null,
      name:         p.name,
      brand:        p.brand ?? null,
      unit:         p.unit ?? null,
      category:     p.category.parentCategory?.name ?? p.category.name,
      subCategory:  p.category.parentCategory ? p.category.name : null,
      displayPrice: displayPrice(p.qneLastSalePrice),
      stockQty:     p.qneAvailableQty,
      inStock:      p.qneAvailableQty === null || p.qneAvailableQty > 0,
      timesOrdered: p._count.quotationItems,
    })),
  }
}

// ── get_products_by_category ─────────────────────────────────────────────────

export async function getProductsByCategory(categorySlug: string, limit = 15): Promise<ToolResult> {
  const category = await prisma.productCategory.findFirst({
    where: { slug: categorySlug, isActive: true },
    include: {
      subCategories: { where: { isActive: true }, select: { id: true } },
    },
  })

  if (!category) {
    return { found: false, message: `Category slug "${categorySlug}" not found. Use list_categories to see valid slugs.` }
  }

  const categoryIds = [category.id, ...category.subCategories.map(s => s.id)]

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: { in: categoryIds },
      OR: [{ qneAvailableQty: null }, { qneAvailableQty: { gt: 0 } }],
    },
    include: {
      category: { include: { parentCategory: true } },
      _count: { select: { quotationItems: true } },
    },
    orderBy: { quotationItems: { _count: 'desc' } },
    take: limit,
  })

  return {
    found: true,
    categoryName: category.name,
    count: products.length,
    products: products.map(p => ({
      itemCode:     p.qneItemCode ?? null,
      name:         p.name,
      brand:        p.brand ?? null,
      unit:         p.unit ?? null,
      subCategory:  p.category.parentCategory ? p.category.name : null,
      displayPrice: displayPrice(p.qneLastSalePrice),
      stockQty:     p.qneAvailableQty,
      timesOrdered: p._count.quotationItems,
    })),
  }
}

// ── get_top_selling_products ─────────────────────────────────────────────────

export async function getTopSellingProducts(categorySlug?: string, limit = 10): Promise<ToolResult> {
  let productIdFilter: string[] | undefined

  if (categorySlug) {
    const category = await prisma.productCategory.findFirst({
      where: { slug: categorySlug, isActive: true },
      include: { subCategories: { where: { isActive: true }, select: { id: true } } },
    })
    if (!category) {
      return { found: false, message: `Category "${categorySlug}" not found. Use list_categories to see valid slugs.` }
    }
    const categoryIds = [category.id, ...category.subCategories.map(s => s.id)]
    const prods = await prisma.product.findMany({
      where: { categoryId: { in: categoryIds }, isActive: true },
      select: { id: true },
    })
    productIdFilter = prods.map(p => p.id)
    if (productIdFilter.length === 0) return { found: true, products: [] }
  }

  const items = await prisma.quotationItem.groupBy({
    by:    ['productId'],
    where: { productId: { not: null, ...(productIdFilter ? { in: productIdFilter } : {}) } },
    _count: { productId: true },
    orderBy: { _count: { productId: 'desc' } },
    take:  limit,
  })

  const productIds = items.map(i => i.productId!).filter(Boolean)
  if (productIds.length === 0) return { found: true, products: [] }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { category: { include: { parentCategory: true } } },
  })

  const productMap = new Map(products.map(p => [p.id, p]))

  return {
    found: true,
    products: items
      .map(item => {
        const p = productMap.get(item.productId!)
        if (!p) return null
        return {
          itemCode:     p.qneItemCode ?? null,
          name:         p.name,
          brand:        p.brand ?? null,
          unit:         p.unit ?? null,
          category:     p.category.parentCategory?.name ?? p.category.name,
          displayPrice: displayPrice(p.qneLastSalePrice),
          stockQty:     p.qneAvailableQty,
          timesOrdered: item._count.productId,
        }
      })
      .filter(Boolean),
  }
}

// ── get_customer_history ─────────────────────────────────────────────────────

export async function getCustomerHistory(companyName: string): Promise<ToolResult> {
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: 'insensitive' } },
    select: {
      id:                 true,
      name:               true,
      industry:           true,
      status:             true,
      outstandingBalance: true,
    },
  })

  if (!company) {
    return { found: false, message: `No company found matching "${companyName}". Try a shorter name fragment.` }
  }

  const quotations = await prisma.quotation.findMany({
    where: { companyId: company.id },
    include: {
      items: {
        include: {
          product: { include: { category: { include: { parentCategory: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  // Aggregate product frequencies
  const freq = new Map<string, { count: number; totalQty: number; product: typeof quotations[0]['items'][0]['product'] }>()

  for (const qt of quotations) {
    for (const item of qt.items) {
      if (!item.product) continue
      const key = item.product.id
      const existing = freq.get(key)
      if (existing) {
        existing.count++
        existing.totalQty += Number(item.qty)
      } else {
        freq.set(key, { count: 1, totalQty: Number(item.qty), product: item.product })
      }
    }
  }

  const topProducts = [...freq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map(({ count, totalQty, product }) => ({
      name:     product!.name,
      brand:    product!.brand ?? null,
      unit:     product!.unit ?? null,
      category: product!.category.parentCategory?.name ?? product!.category.name,
      timesOrdered: count,
      totalQty: Math.round(totalQty),
    }))

  return {
    found:              true,
    company:            company.name,
    industry:           company.industry ?? 'Not specified',
    status:             company.status,
    outstandingBalance: company.outstandingBalance ? Number(company.outstandingBalance).toFixed(2) : null,
    quotationsOnRecord: quotations.length,
    topProducts,
    note: topProducts.length === 0
      ? 'No quotation history yet — this is a new or unquoted client.'
      : undefined,
  }
}

// ── get_industry_buying_patterns ─────────────────────────────────────────────

export async function getIndustryBuyingPatterns(industry: string, limit = 10): Promise<ToolResult> {
  const companies = await prisma.company.findMany({
    where: { industry: { contains: industry, mode: 'insensitive' } },
    select: { id: true, name: true },
  })

  if (companies.length === 0) {
    return {
      found:   false,
      message: `No clients found in industry matching "${industry}". Try broader terms like "manufacturing", "F&B", "hotel", "law", "finance".`,
    }
  }

  const companyIds = companies.map(c => c.id)
  const quotations = await prisma.quotation.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true },
  })

  if (quotations.length === 0) {
    return {
      found:     true,
      industry,
      companies: companies.length,
      message:   'Clients found in this industry but no quotations on record yet.',
    }
  }

  const quotationIds = quotations.map(q => q.id)

  const items = await prisma.quotationItem.groupBy({
    by:    ['productId'],
    where: { quotationId: { in: quotationIds }, productId: { not: null } },
    _count: { productId: true },
    _sum:   { qty: true },
    orderBy: { _count: { productId: 'desc' } },
    take:  limit,
  })

  const productIds = items.map(i => i.productId!).filter(Boolean)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { category: { include: { parentCategory: true } } },
  })

  const productMap = new Map(products.map(p => [p.id, p]))

  return {
    found:               true,
    industry,
    companiesAnalyzed:   companies.length,
    quotationsAnalyzed:  quotations.length,
    topProducts: items
      .map(item => {
        const p = productMap.get(item.productId!)
        if (!p) return null
        return {
          name:         p.name,
          brand:        p.brand ?? null,
          unit:         p.unit ?? null,
          category:     p.category.parentCategory?.name ?? p.category.name,
          timesOrdered: item._count.productId,
          totalQtyOrdered: item._sum.qty ? Math.round(Number(item._sum.qty)) : null,
          displayPrice: displayPrice(p.qneLastSalePrice),
        }
      })
      .filter(Boolean),
  }
}

// ── list_my_companies ────────────────────────────────────────────────────────

export async function listMyCompanies(userId: string, limit = 50): Promise<ToolResult> {
  const assignments = await prisma.companyAssignment.findMany({
    where:   { userId, unassignedAt: null },
    select:  { companyId: true },
    orderBy: { assignedAt: 'desc' },
    take:    limit,
  })

  if (assignments.length === 0) {
    return { found: false, message: 'No companies are currently assigned to you.' }
  }

  const companyIds = assignments.map(a => a.companyId)
  const companies = await prisma.company.findMany({
    where:  { id: { in: companyIds } },
    select: {
      id:                 true,
      name:               true,
      status:             true,
      industry:           true,
      outstandingBalance: true,
      qneCustomerCode:    true,
    },
  })

  // Preserve assignment order
  const companyMap = new Map(companies.map(c => [c.id, c]))

  return {
    found: true,
    count: companies.length,
    companies: companyIds
      .map(id => {
        const c = companyMap.get(id)
        if (!c) return null
        return {
          name:               c.name,
          status:             c.status,
          industry:           c.industry ?? null,
          outstandingBalance: c.outstandingBalance
            ? Number(c.outstandingBalance).toFixed(2)
            : null,
          qneCode: c.qneCustomerCode ?? null,
        }
      })
      .filter(Boolean),
  }
}

// ── get_client_purchase_history (QNE invoices) ──────────────────────────────

export async function getClientPurchaseHistory(companyName: string, months = 12): Promise<ToolResult> {
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: 'insensitive' } },
    select: { id: true, name: true, qneCustomerCode: true, outstandingBalance: true, overdueAmount: true },
  })

  if (!company) {
    return { found: false, message: `No company found matching "${companyName}".` }
  }

  const since = new Date()
  since.setMonth(since.getMonth() - months)

  const invoices = await prisma.qneInvoice.findMany({
    where: { companyId: company.id, docDate: { gte: since } },
    include: { items: { include: { product: { select: { name: true, brand: true, unit: true } } } } },
    orderBy: { docDate: 'desc' },
    take: 50,
  })

  if (invoices.length === 0) {
    return {
      found: true,
      company: company.name,
      message: `No QNE invoices found for ${company.name} in the last ${months} months. Run syncQneInvoices.ts with VPN to populate history.`,
      outstandingBalance: company.outstandingBalance ? Number(company.outstandingBalance).toFixed(2) : null,
    }
  }

  // Aggregate item frequencies across invoices
  const itemFreq = new Map<string, { description: string; invoiceCount: number; totalQty: number; totalSpend: number; lastDate: Date; unit: string | null }>()
  let totalSpend = 0

  for (const inv of invoices) {
    totalSpend += Number(inv.totalAmount)
    for (const item of inv.items) {
      const key = item.stockCode ?? item.description
      const existing = itemFreq.get(key)
      if (existing) {
        existing.invoiceCount++
        existing.totalQty   += Number(item.qty)
        existing.totalSpend += Number(item.lineTotal)
        if (inv.docDate > existing.lastDate) existing.lastDate = inv.docDate
      } else {
        itemFreq.set(key, {
          description:  item.product?.name ?? item.description,
          invoiceCount: 1,
          totalQty:     Number(item.qty),
          totalSpend:   Number(item.lineTotal),
          lastDate:     inv.docDate,
          unit:         item.product?.unit ?? null,
        })
      }
    }
  }

  const topItems = [...itemFreq.values()]
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 15)

  return {
    found: true,
    company: company.name,
    period: `Last ${months} months`,
    invoiceCount: invoices.length,
    totalSpend: `RM ${totalSpend.toFixed(2)}`,
    lastOrderDate: invoices[0]?.docDate?.toISOString().slice(0, 10),
    outstandingBalance: company.outstandingBalance ? `RM ${Number(company.outstandingBalance).toFixed(2)}` : null,
    overdueAmount: company.overdueAmount && Number(company.overdueAmount) > 0
      ? `RM ${Number(company.overdueAmount).toFixed(2)}`
      : null,
    topItems: topItems.map(i => ({
      description:  i.description,
      unit:         i.unit,
      invoiceCount: i.invoiceCount,
      totalQty:     Math.round(i.totalQty),
      totalSpend:   `RM ${i.totalSpend.toFixed(2)}`,
      lastOrderDate: i.lastDate.toISOString().slice(0, 10),
    })),
  }
}

// ── suggest_reorder_items ────────────────────────────────────────────────────

export async function suggestReorderItems(companyName: string): Promise<ToolResult> {
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: 'insensitive' } },
    select: { id: true, name: true },
  })

  if (!company) {
    return { found: false, message: `No company found matching "${companyName}".` }
  }

  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  // Items ordered in past 12 months
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)

  const invoices = await prisma.qneInvoice.findMany({
    where: { companyId: company.id, docDate: { gte: yearAgo } },
    include: { items: true },
    orderBy: { docDate: 'desc' },
  })

  if (invoices.length === 0) {
    return {
      found: true,
      company: company.name,
      message: 'No invoice history found. Run syncQneInvoices.ts with VPN first.',
    }
  }

  const itemMap = new Map<string, { description: string; totalOrders: number; avgQty: number; lastOrderDate: Date; stockCode: string | null }>()

  for (const inv of invoices) {
    for (const item of inv.items) {
      const key = item.stockCode ?? item.description
      const existing = itemMap.get(key)
      if (existing) {
        existing.totalOrders++
        existing.avgQty = (existing.avgQty * (existing.totalOrders - 1) + Number(item.qty)) / existing.totalOrders
        if (inv.docDate > existing.lastOrderDate) existing.lastOrderDate = inv.docDate
      } else {
        itemMap.set(key, {
          description:   item.description,
          totalOrders:   1,
          avgQty:        Number(item.qty),
          lastOrderDate: inv.docDate,
          stockCode:     item.stockCode,
        })
      }
    }
  }

  // Suggest items not ordered recently (>60 days) but ordered multiple times before = likely recurring
  const suggestions = [...itemMap.values()]
    .filter(i => i.totalOrders >= 2 && i.lastOrderDate < threeMonthsAgo)
    .sort((a, b) => b.totalOrders - a.totalOrders)
    .slice(0, 10)

  const recentItems = [...itemMap.values()]
    .filter(i => i.lastOrderDate >= threeMonthsAgo)
    .sort((a, b) => b.lastOrderDate.getTime() - a.lastOrderDate.getTime())
    .slice(0, 5)

  return {
    found: true,
    company: company.name,
    invoicesAnalyzed: invoices.length,
    suggestedReorders: suggestions.map(i => ({
      description:   i.description,
      stockCode:     i.stockCode,
      timesOrdered:  i.totalOrders,
      avgQty:        Math.round(i.avgQty),
      lastOrdered:   i.lastOrderDate.toISOString().slice(0, 10),
      daysSinceLastOrder: Math.round((Date.now() - i.lastOrderDate.getTime()) / 86400000),
    })),
    recentlyOrdered: recentItems.map(i => ({
      description: i.description,
      lastOrdered: i.lastOrderDate.toISOString().slice(0, 10),
    })),
    tip: suggestions.length === 0
      ? 'All recurring items were ordered recently — good coverage!'
      : `${suggestions.length} items are overdue for reorder based on past patterns.`,
  }
}

// ── get_inactive_clients ─────────────────────────────────────────────────────

export async function getInactiveClients(daysSinceLastOrder = 90, salesPersonName?: string): Promise<ToolResult> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysSinceLastOrder)

  // Find companies with last invoice before cutoff (or no invoices at all but QNE synced)
  const activeCompanies = await prisma.company.findMany({
    where: {
      qneCustomerCode: { not: null },
      ...(salesPersonName ? {
        assignments: {
          some: {
            unassignedAt: null,
            user: { name: { contains: salesPersonName, mode: 'insensitive' } },
          },
        },
      } : {}),
    },
    select: {
      id: true,
      name: true,
      industry: true,
      outstandingBalance: true,
      qneInvoices: {
        orderBy: { docDate: 'desc' },
        take: 1,
        select: { docDate: true, totalAmount: true },
      },
      assignments: {
        where: { unassignedAt: null },
        select: { user: { select: { name: true } } },
        take: 1,
      },
    },
  })

  const inactive = activeCompanies
    .filter(c => {
      const lastInvoice = c.qneInvoices[0]
      return !lastInvoice || lastInvoice.docDate < cutoff
    })
    .map(c => ({
      name:               c.name,
      industry:           c.industry ?? null,
      assignedTo:         c.assignments[0]?.user.name ?? 'Unassigned',
      lastOrderDate:      c.qneInvoices[0]?.docDate?.toISOString().slice(0, 10) ?? 'Never (in sync period)',
      daysSinceOrder:     c.qneInvoices[0]
        ? Math.round((Date.now() - c.qneInvoices[0].docDate.getTime()) / 86400000)
        : null,
      outstandingBalance: c.outstandingBalance ? `RM ${Number(c.outstandingBalance).toFixed(2)}` : null,
    }))
    .sort((a, b) => (b.daysSinceOrder ?? 9999) - (a.daysSinceOrder ?? 9999))
    .slice(0, 25)

  return {
    found: true,
    threshold: `${daysSinceLastOrder} days`,
    filter: salesPersonName ?? 'All salespeople',
    count: inactive.length,
    clients: inactive,
    tip: inactive.length === 0
      ? 'All clients ordered recently — great account activity!'
      : `${inactive.length} clients need a follow-up call.`,
  }
}

// ── get_top_products_by_revenue ──────────────────────────────────────────────

export async function getTopProductsByRevenue(months = 6, categoryName?: string): Promise<ToolResult> {
  const since = new Date()
  since.setMonth(since.getMonth() - months)

  const invoiceItems = await prisma.qneInvoiceItem.findMany({
    where: {
      invoice: { docDate: { gte: since } },
      ...(categoryName ? {
        product: {
          category: {
            OR: [
              { name: { contains: categoryName, mode: 'insensitive' } },
              { parentCategory: { name: { contains: categoryName, mode: 'insensitive' } } },
            ],
          },
        },
      } : {}),
    },
    include: {
      product: {
        select: {
          name: true,
          brand: true,
          unit: true,
          qneItemCode: true,
          category: { include: { parentCategory: true } },
        },
      },
    },
  })

  if (invoiceItems.length === 0) {
    return {
      found: false,
      message: `No invoice items found for the last ${months} months${categoryName ? ` in category "${categoryName}"` : ''}. Run syncQneInvoices.ts first.`,
    }
  }

  // Aggregate by stock code / description
  const agg = new Map<string, { description: string; brand: string | null; category: string; totalRevenue: number; totalQty: number; invoiceCount: number }>()

  for (const item of invoiceItems) {
    const key = item.stockCode ?? item.description
    const category = item.product?.category.parentCategory?.name ?? item.product?.category.name ?? 'Unknown'
    const existing = agg.get(key)
    if (existing) {
      existing.totalRevenue += Number(item.lineTotal)
      existing.totalQty    += Number(item.qty)
      existing.invoiceCount++
    } else {
      agg.set(key, {
        description:  item.product?.name ?? item.description,
        brand:        item.product?.brand ?? null,
        category,
        totalRevenue: Number(item.lineTotal),
        totalQty:     Number(item.qty),
        invoiceCount: 1,
      })
    }
  }

  const ranked = [...agg.values()]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 15)

  const totalRevenue = ranked.reduce((s, i) => s + i.totalRevenue, 0)

  return {
    found: true,
    period: `Last ${months} months`,
    categoryFilter: categoryName ?? 'All categories',
    totalRevenue: `RM ${totalRevenue.toFixed(2)}`,
    topProducts: ranked.map((i, idx) => ({
      rank:         idx + 1,
      description:  i.description,
      brand:        i.brand,
      category:     i.category,
      revenue:      `RM ${i.totalRevenue.toFixed(2)}`,
      qty:          Math.round(i.totalQty),
      invoiceCount: i.invoiceCount,
      revenuePct:   `${((i.totalRevenue / totalRevenue) * 100).toFixed(1)}%`,
    })),
  }
}

// ── get_client_financials ────────────────────────────────────────────────────

export async function getClientFinancials(companyName: string): Promise<ToolResult> {
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: 'insensitive' } },
    select: {
      name:                true,
      outstandingBalance:  true,
      creditLimit:         true,
      overdueAmount:       true,
      outstandingUpdatedAt: true,
      status:              true,
      qneCustomerCode:     true,
    },
  })

  if (!company) {
    return { found: false, message: `No company found matching "${companyName}".` }
  }

  if (!company.outstandingUpdatedAt) {
    return {
      found: true,
      company: company.name,
      message: 'Financial data not yet synced. Run syncQneAging.ts with VPN to populate balances.',
    }
  }

  const outstanding = Number(company.outstandingBalance ?? 0)
  const credit      = Number(company.creditLimit ?? 0)
  const overdue     = Number(company.overdueAmount ?? 0)
  const utilisation = credit > 0 ? (outstanding / credit * 100).toFixed(1) : null

  return {
    found:              true,
    company:            company.name,
    qneCode:            company.qneCustomerCode,
    outstandingBalance: `RM ${outstanding.toFixed(2)}`,
    creditLimit:        credit > 0 ? `RM ${credit.toFixed(2)}` : 'Not set',
    creditUtilisation:  utilisation ? `${utilisation}%` : null,
    overdueAmount:      overdue > 0 ? `RM ${overdue.toFixed(2)}` : 'None',
    isOverdue:          overdue > 0,
    isSafeToQuote:      overdue === 0 && (credit === 0 || outstanding < credit * 0.9),
    lastSyncedAt:       company.outstandingUpdatedAt.toISOString().slice(0, 10),
    advice:             overdue > 0
      ? `⚠️ Client has RM ${overdue.toFixed(2)} overdue — confirm with finance before quoting large orders.`
      : outstanding > 0 && credit > 0 && outstanding >= credit * 0.9
        ? `⚠️ Client is at ${utilisation}% credit utilisation — approaching limit.`
        : `✅ Financials look healthy — safe to quote.`,
  }
}

// ── list_categories ─────────────────────────────────────────────────────────

export async function listCategories(): Promise<ToolResult> {
  const parents = await prisma.productCategory.findMany({
    where: { parentCategoryId: null, isActive: true },
    include: {
      subCategories: {
        where: { isActive: true },
        include: { _count: { select: { products: { where: { isActive: true } } } } },
        orderBy: { name: 'asc' },
      },
      _count: { select: { products: { where: { isActive: true } } } },
    },
    orderBy: { name: 'asc' },
  })

  return {
    categories: parents.map(parent => ({
      name:          parent.name,
      slug:          parent.slug,
      totalProducts: parent._count.products,
      subCategories: parent.subCategories.map(sub => ({
        name:         sub.name,
        slug:         sub.slug,
        productCount: sub._count.products,
      })),
    })),
  }
}
