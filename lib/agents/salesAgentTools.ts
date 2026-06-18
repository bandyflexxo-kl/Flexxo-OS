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
