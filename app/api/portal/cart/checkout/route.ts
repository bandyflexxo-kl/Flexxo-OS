import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/webpush'
import { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'

// B5: orders below this subtotal auto-include a flat delivery charge (QNE stock
// code DELIVERYFEE) so small orders cover their delivery cost.
const DELIVERY_FREE_THRESHOLD = 300
const DELIVERY_FEE_AMOUNT     = 25

const BodySchema = z.object({
  poNumber:          z.string().max(100).nullable().optional(),
  costCentre:        z.string().max(100).nullable().optional(),
  deliveryAddressId: z.string().uuid().nullable().optional(),
})

export async function POST(request: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ error: 'No company linked to this account.' }, { status: 400 })
  }

  let poNumber:          string | null = null
  let costCentre:        string | null = null
  let deliveryAddressId: string | null = null
  try {
    const raw  = await request.json().catch(() => ({}))
    const body = BodySchema.parse(raw)
    poNumber          = body.poNumber          ?? null
    costCentre        = body.costCentre        ?? null
    deliveryAddressId = body.deliveryAddressId ?? null
  } catch { /* optional fields — ignore parse errors */ }

  const cart = await prisma.quotation.findFirst({
    where: { status: 'cart', createdById: session.userId },
    include: { items: { select: { id: true } } },
  })

  if (!cart) return Response.json({ error: 'No active cart found.' }, { status: 400 })
  if (cart.items.length === 0) return Response.json({ error: 'Your cart is empty.' }, { status: 400 })

  // Resolve the chosen delivery address (must belong to this company) and snapshot
  // it onto the quote so sales + fulfilment + the delivery run know where to deliver.
  let deliveryAddress:   string | null = null
  let deliveryRecipient: string | null = null
  let deliveryPhone:     string | null = null
  if (deliveryAddressId) {
    const addr = await prisma.companyAddress.findFirst({
      where:  { id: deliveryAddressId, companyId: session.customerCompanyId, isActive: true },
      select: { label: true, line1: true, line2: true, city: true, state: true, postcode: true, phone: true },
    })
    if (!addr) return Response.json({ error: 'Selected delivery address not found.' }, { status: 400 })
    deliveryAddress   = [addr.line1, addr.line2, addr.city, addr.postcode, addr.state].filter(Boolean).join(', ')
    deliveryRecipient = addr.label ?? null
    deliveryPhone     = addr.phone ?? null
  }

  // Generate permanent reference number: QT-YYYY-NNNN
  const year     = new Date().getFullYear()
  const count    = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  const refNo    = `QT-${year}-${String(count + 1).padStart(4, '0')}`

  // B7: this company's standing discount % (e.g. the 15% new-customer welcome).
  const discCompany = await prisma.company.findUnique({ where: { id: session.customerCompanyId }, select: { discountPct: true } })
  const discountPct = discCompany?.discountPct ? Number(discCompany.discountPct) : 0

  const quotation = await prisma.$transaction(async tx => {
    const cartItems     = await tx.quotationItem.findMany({ where: { quotationId: cart.id }, select: { lineTotal: true, productId: true } })
    const goodsSubtotal = cartItems.reduce((s, i) => s.plus(i.lineTotal), new Prisma.Decimal(0))

    // B5: flat RM25 delivery charge when the goods subtotal is below RM300.
    let deliveryFee = new Prisma.Decimal(0)
    const deliveryProduct = await tx.product.findFirst({
      where:  { qneItemCode: { equals: 'DELIVERYFEE', mode: 'insensitive' } },
      select: { id: true, name: true, brand: true, unit: true },
    })
    const alreadyHasFee = deliveryProduct ? cartItems.some(i => i.productId === deliveryProduct.id) : false
    if (deliveryProduct && !alreadyHasFee && goodsSubtotal.lessThan(DELIVERY_FREE_THRESHOLD)) {
      await tx.quotationItem.create({
        data: {
          quotationId: cart.id,
          productId:   deliveryProduct.id,
          description: deliveryProduct.name,
          brand:       deliveryProduct.brand ?? undefined,
          unit:        deliveryProduct.unit  ?? undefined,
          qty:         new Prisma.Decimal(1),
          unitCost:    new Prisma.Decimal(DELIVERY_FEE_AMOUNT),
          unitPrice:   new Prisma.Decimal(DELIVERY_FEE_AMOUNT),
          marginPct:   new Prisma.Decimal(0),
          lineTotal:   new Prisma.Decimal(DELIVERY_FEE_AMOUNT),
          sortOrder:   cartItems.length,
        },
      })
      deliveryFee = new Prisma.Decimal(DELIVERY_FEE_AMOUNT)
    }

    // B7: customer discount applies to the goods only (not the delivery charge).
    const subtotal       = goodsSubtotal.plus(deliveryFee)
    const discountAmount = goodsSubtotal.times(discountPct).dividedBy(100).toDecimalPlaces(2)
    const totalAmount    = subtotal.minus(discountAmount)

    const updated = await tx.quotation.update({
      where: { id: cart.id },
      data:  {
        status: 'pending_review', referenceNo: refNo, poNumber, costCentre,
        deliveryAddressId, deliveryAddress, deliveryRecipient, deliveryPhone,
        subtotal, discountAmount, totalAmount,
      },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: cart.id,
        fromStatus:  'cart',
        toStatus:    'pending_review',
        changedById: session.userId,
        notes:       'Submitted by customer via portal',
      },
    })
    return updated
  })

  // Push: notify the salesperson assigned to this company (fire-and-forget)
  const assignment = await prisma.companyAssignment.findFirst({
    where:   { companyId: session.customerCompanyId, unassignedAt: null },
    select:  { userId: true },
    orderBy: { assignedAt: 'desc' },
  })
  if (assignment) {
    sendPushToUser(assignment.userId, {
      title: '🛒 New Quote Request',
      body:  `${refNo} — a client just submitted a new quote request from the portal.`,
      url:   `/quotations/${quotation.id}`,
    }).catch(() => undefined)
  }

  return Response.json({ quotationId: quotation.id, referenceNo: refNo })
}
