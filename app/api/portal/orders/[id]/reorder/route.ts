/**
 * POST /api/portal/orders/[id]/reorder
 *
 * Copies all items from a past order into the current B2B cart.
 * If the item's product no longer has a price, it is skipped.
 * Uses the same cart-find-or-create logic as /api/portal/cart/items.
 *
 * Condition 24: powers the ReorderButton on the orders list page.
 */

import { getOptionalShopSession }   from '@/lib/session'
import { prisma }               from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { Prisma }               from '@/app/generated/prisma/client'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ error: 'No company linked to this account.' }, { status: 400 })
  }

  const { id: orderId } = await params

  // ── Fetch order + items ──────────────────────────────────────────
  const order = await prisma.order.findUnique({
    where: { id: orderId, companyId: session.customerCompanyId },
    include: {
      items: {
        include: {
          product: {
            include: {
              category:      { select: { defaultMarginPct: true } },
              priceVersions: {
                where:   { isCurrent: true },
                orderBy: { approvedAt: 'desc' },
                take:    1,
                select:  { id: true, costPrice: true, currency: true, unit: true },
              },
            },
          },
          quotationItem: { select: { description: true, brand: true, unit: true } },
        },
      },
    },
  })

  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 })
  if (order.items.length === 0) return Response.json({ error: 'This order has no items.' }, { status: 422 })

  // ── Get B2B margin setting ───────────────────────────────────────
  const globalSetting = await prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } })
  const globalMargin  = globalSetting?.value ?? '30'

  // ── Find or create cart quotation ────────────────────────────────
  let cart = await prisma.quotation.findFirst({
    where:  { status: 'cart', createdById: session.userId },
    select: { id: true },
  })

  if (!cart) {
    const firstItem   = order.items[0]
    const cartCurrency = firstItem.product?.priceVersions[0]?.currency ?? order.currency ?? 'MYR'
    cart = await prisma.quotation.create({
      data: {
        companyId:     session.customerCompanyId,
        createdById:   session.userId,
        status:        'cart',
        referenceNo:   `CART-${session.userId.slice(-8)}-${Date.now()}`,
        currency:      cartCurrency,
        versionNumber: 1,
        subtotal:      new Prisma.Decimal(0),
        totalAmount:   new Prisma.Decimal(0),
      },
      select: { id: true },
    })
  }

  // ── Add order items to cart ──────────────────────────────────────
  let added = 0
  let skipped = 0

  for (const item of order.items) {
    const product = item.product
    if (!product || !product.priceVersions[0]) { skipped++; continue }

    const costPrice  = product.priceVersions[0].costPrice
    const unitPrice  = roundPrice(
      calculateSellingPrice(
        costPrice,
        product.defaultMarginPct,
        product.category.defaultMarginPct,
        globalMargin,
      )
    )
    const qtyDec     = new Prisma.Decimal(item.qty.toString())
    const lineTotal  = unitPrice.times(qtyDec)
    const description = item.quotationItem?.description ?? product.name
    const brand       = item.quotationItem?.brand       ?? product.brand  ?? null
    const unit        = item.quotationItem?.unit        ?? product.unit   ?? null

    // Upsert: if already in cart, increase qty
    const existing = await prisma.quotationItem.findFirst({
      where: { quotationId: cart.id, productId: product.id },
    })

    if (existing) {
      const newQty   = new Prisma.Decimal(existing.qty.toString()).plus(qtyDec)
      const newTotal = unitPrice.times(newQty)
      await prisma.quotationItem.update({
        where: { id: existing.id },
        data:  { qty: newQty, unitPrice, lineTotal: newTotal },
      })
    } else {
      await prisma.quotationItem.create({
        data: {
          quotationId:  cart.id,
          productId:    product.id,
          description,
          brand,
          unit,
          qty:          qtyDec,
          unitPrice,
          lineTotal,
          sortOrder:    added,
        },
      })
    }
    added++
  }

  if (added === 0) {
    return Response.json({ error: 'No items could be added (products may no longer be available).' }, { status: 422 })
  }

  return Response.json({ success: true, added, skipped })
}
