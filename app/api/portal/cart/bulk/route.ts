/**
 * POST /api/portal/cart/bulk
 *
 * Bulk-add multiple items to the B2B cart in a single request.
 * Used by the Quick Reorder modal on the dashboard.
 *
 * Body: { items: { productId: string; qty: number }[] }
 * Auth: B2B Client only
 *
 * Returns: { ok: true; cartId: string; addedCount: number; skippedCount: number }
 */

import { NextResponse }           from 'next/server'
import { getOptionalShopSession } from '@/lib/session'
import { prisma }                 from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { Prisma }                 from '@/app/generated/prisma/client'
import { z }                      from 'zod'

const Schema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      qty:       z.number().int().positive().max(9999),
    })
  ).min(1).max(100),
})

export async function POST(request: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return NextResponse.json({ error: 'No company linked to this account.' }, { status: 400 })
  }

  const body   = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { items } = parsed.data
  const productIds = items.map(i => i.productId)

  // ── Fetch all requested products + pricing in one query ───────────────────
  const [products, globalSetting] = await Promise.all([
    prisma.product.findMany({
      where:   { id: { in: productIds }, isActive: true, isVisibleToCustomers: true },
      include: {
        category:      { select: { defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { id: true, costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } }),
  ])

  const productMap = new Map(products.map(p => [p.id, p]))
  const globalMargin = globalSetting?.value ?? '30'

  // ── Find or create cart quotation ─────────────────────────────────────────
  let cart = await prisma.quotation.findFirst({
    where:  { status: 'cart', createdById: session.userId },
    select: { id: true, currency: true },
  })

  const defaultCurrency = products[0]?.priceVersions[0]?.currency ?? 'MYR'

  if (!cart) {
    cart = await prisma.quotation.create({
      data: {
        companyId:     session.customerCompanyId,
        createdById:   session.userId,
        status:        'cart',
        referenceNo:   `CART-${session.userId.slice(-8)}-${Date.now()}`,
        currency:      defaultCurrency,
        versionNumber: 1,
        subtotal:      new Prisma.Decimal(0),
        totalAmount:   new Prisma.Decimal(0),
      },
      select: { id: true, currency: true },
    })
  }

  const cartId = cart.id

  // ── Fetch existing cart items (to detect duplicates) ──────────────────────
  const existingItems = await prisma.quotationItem.findMany({
    where:  { quotationId: cartId, productId: { in: productIds } },
    select: { id: true, productId: true, qty: true },
  })
  const existingMap = new Map(existingItems.map(i => [i.productId, i]))

  let addedCount   = 0
  let skippedCount = 0

  // ── Upsert each item ──────────────────────────────────────────────────────
  for (const reqItem of items) {
    const product = productMap.get(reqItem.productId)
    if (!product || !product.priceVersions[0]) { skippedCount++; continue }

    const costPrice = product.priceVersions[0].costPrice
    const unitPrice = roundPrice(
      calculateSellingPrice(costPrice, product.defaultMarginPct, product.category.defaultMarginPct, globalMargin)
    )
    const qty = new Prisma.Decimal(reqItem.qty)

    const existing = existingMap.get(reqItem.productId)

    if (existing) {
      // Replace qty (not add) — user explicitly chose this qty in the modal
      const newLineTotal = unitPrice.times(qty)
      await prisma.quotationItem.update({
        where: { id: existing.id },
        data:  { qty, lineTotal: newLineTotal },
      })
    } else {
      const itemCount = await prisma.quotationItem.count({ where: { quotationId: cartId } })
      await prisma.quotationItem.create({
        data: {
          quotationId:            cartId,
          productId:              reqItem.productId,
          supplierPriceVersionId: product.priceVersions[0].id,
          description:            product.name,
          brand:                  product.brand ?? undefined,
          unit:                   product.unit  ?? undefined,
          qty,
          unitCost:  costPrice,
          unitPrice,
          marginPct: unitPrice.minus(costPrice).dividedBy(unitPrice).times(100),
          lineTotal: unitPrice.times(qty),
          sortOrder: itemCount,
        },
      })
    }
    addedCount++
  }

  // ── Recalculate cart totals ───────────────────────────────────────────────
  const allItems = await prisma.quotationItem.findMany({ where: { quotationId: cartId } })
  const subtotal  = allItems.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0))
  await prisma.quotation.update({
    where: { id: cartId },
    data:  { subtotal, totalAmount: subtotal },
  })

  return NextResponse.json({ ok: true, cartId, addedCount, skippedCount })
}
