/**
 * GET  /api/portal/orders/[id]/reorder — returns order items with current pricing for the reorder modal
 * POST /api/portal/orders/[id]/reorder — adds items to cart with optional quantity overrides
 *
 * Items WITHOUT a CRM product match (productId = null) are included using the original order price.
 * They are added to the cart as free-text items (productId = null, description preserved).
 *
 * POST body (optional): { lines: { itemId: string; qty: number }[] }
 * itemId is the OrderItem.id. Items with qty <= 0 are skipped.
 */

import { getOptionalShopSession }            from '@/lib/session'
import { prisma }                            from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { Prisma }                            from '@/app/generated/prisma/client'
import { z }                                 from 'zod'

const LineSchema = z.object({
  itemId: z.string().uuid(),
  qty:    z.number().positive(),
})
const BodySchema = z.object({
  lines: z.array(LineSchema).optional(),
})

// ── Shared: fetch order with all items ───────────────────────────────────────

async function fetchOrder(orderId: string, companyId: string) {
  return prisma.order.findUnique({
    where: { id: orderId, companyId },
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
          quotationItem: { select: { description: true, brand: true, unit: true, unitPrice: true } },
        },
      },
    },
  })
}

// ── GET — preview items + prices for the modal ───────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ error: 'No company linked.' }, { status: 400 })
  }

  const { id: orderId } = await params
  const order = await fetchOrder(orderId, session.customerCompanyId)
  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 })

  const globalSetting = await prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } })
  const globalMargin  = globalSetting?.value ?? '30'

  const lines = order.items.map(item => {
    const product = item.product

    // Matched product: use live repriced cost
    if (product && product.priceVersions[0]) {
      const unitPrice = roundPrice(
        calculateSellingPrice(
          product.priceVersions[0].costPrice,
          product.defaultMarginPct,
          product.category.defaultMarginPct,
          globalMargin,
        )
      )
      const qty         = Number(item.qty.toString())
      const description = item.quotationItem?.description ?? product.name
      const brand       = item.quotationItem?.brand       ?? product.brand  ?? null
      const unit        = item.quotationItem?.unit        ?? product.unit   ?? product.priceVersions[0].unit ?? null
      return {
        itemId:      item.id,
        productId:   product.id,
        name:        product.name,
        description,
        brand,
        unit,
        qty,
        unitPrice:   Number(unitPrice.toString()),
        lineTotal:   Number(unitPrice.times(new Prisma.Decimal(qty)).toString()),
        repriced:    true,
      }
    }

    // Unmatched item: use original order price (from quotation item or order item)
    const qty         = Number(item.qty.toString())
    const unitPrice   = Number(
      item.quotationItem?.unitPrice?.toString() ?? item.unitPrice.toString()
    )
    const description = item.quotationItem?.description ?? 'Unknown item'
    const brand       = item.quotationItem?.brand ?? null
    const unit        = item.quotationItem?.unit  ?? null
    return {
      itemId:      item.id,
      productId:   null as string | null,
      name:        description,
      description,
      brand,
      unit,
      qty,
      unitPrice,
      lineTotal:   unitPrice * qty,
      repriced:    false,
    }
  })

  return Response.json({
    orderId,
    referenceNo: order.referenceNo,
    lines,
    currency: order.currency ?? 'MYR',
  })
}

// ── POST — add to cart (optional qty overrides keyed by itemId) ───────────────

export async function POST(
  req: Request,
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

  // Parse optional body
  let qtyOverrides: Map<string, number> | null = null
  try {
    const raw    = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(raw)
    if (parsed.success && parsed.data.lines && parsed.data.lines.length > 0) {
      qtyOverrides = new Map(parsed.data.lines.map(l => [l.itemId, l.qty]))
    }
  } catch { /* no body — use original quantities */ }

  const order = await fetchOrder(orderId, session.customerCompanyId)
  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 })
  if (order.items.length === 0) return Response.json({ error: 'This order has no items.' }, { status: 422 })

  const globalSetting = await prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } })
  const globalMargin  = globalSetting?.value ?? '30'

  // ── Find or create cart quotation ────────────────────────────────
  let cart = await prisma.quotation.findFirst({
    where:  { status: 'cart', createdById: session.userId },
    select: { id: true },
  })

  if (!cart) {
    cart = await prisma.quotation.create({
      data: {
        companyId:     session.customerCompanyId,
        createdById:   session.userId,
        status:        'cart',
        referenceNo:   `CART-${session.userId.slice(-8)}-${Date.now()}`,
        currency:      order.currency ?? 'MYR',
        versionNumber: 1,
        subtotal:      new Prisma.Decimal(0),
        totalAmount:   new Prisma.Decimal(0),
      },
      select: { id: true },
    })
  }

  let added   = 0
  let skipped = 0

  for (const item of order.items) {
    const originalQty = Number(item.qty.toString())
    const useQty = qtyOverrides
      ? (qtyOverrides.get(item.id) ?? 0)
      : originalQty
    if (useQty <= 0) { skipped++; continue }

    const product     = item.product
    const qtyDec      = new Prisma.Decimal(useQty.toString())
    const description = item.quotationItem?.description ?? product?.name ?? 'Item'
    const brand       = item.quotationItem?.brand ?? product?.brand ?? null
    const unit        = item.quotationItem?.unit  ?? product?.unit  ?? null

    let unitPrice: Prisma.Decimal
    let productId: string | null = null

    if (product && product.priceVersions[0]) {
      // Matched product — use live repriced cost
      productId = product.id
      unitPrice = roundPrice(
        calculateSellingPrice(
          product.priceVersions[0].costPrice,
          product.defaultMarginPct,
          product.category.defaultMarginPct,
          globalMargin,
        )
      )
    } else {
      // Unmatched item — use original price from quotation item or order item
      const rawPrice = item.quotationItem?.unitPrice?.toString() ?? item.unitPrice.toString()
      unitPrice = new Prisma.Decimal(rawPrice)
    }

    const lineTotal = unitPrice.times(qtyDec)

    if (productId) {
      // Product-linked: upsert (replace qty if overrides, accumulate if one-click)
      const existing = await prisma.quotationItem.findFirst({
        where: { quotationId: cart.id, productId },
      })
      if (existing) {
        const newQty = qtyOverrides
          ? qtyDec
          : new Prisma.Decimal(existing.qty.toString()).plus(qtyDec)
        await prisma.quotationItem.update({
          where: { id: existing.id },
          data:  { qty: newQty, unitPrice, lineTotal: unitPrice.times(newQty) },
        })
      } else {
        await prisma.quotationItem.create({
          data: { quotationId: cart.id, productId, description, brand, unit, qty: qtyDec, unitPrice, lineTotal, sortOrder: added },
        })
      }
    } else {
      // Free-text item: always create new (no productId to deduplicate on)
      await prisma.quotationItem.create({
        data: { quotationId: cart.id, productId: null, description, brand, unit, qty: qtyDec, unitPrice, lineTotal, sortOrder: added },
      })
    }

    added++
  }

  if (added === 0) {
    return Response.json({ error: 'No items could be added (all quantities set to 0).' }, { status: 422 })
  }

  return Response.json({ success: true, added, skipped })
}
