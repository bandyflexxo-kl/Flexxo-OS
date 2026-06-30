import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/webpush'
import { z } from 'zod'

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

  const quotation = await prisma.$transaction(async tx => {
    const updated = await tx.quotation.update({
      where: { id: cart.id },
      data:  {
        status: 'pending_review', referenceNo: refNo, poNumber, costCentre,
        deliveryAddressId, deliveryAddress, deliveryRecipient, deliveryPhone,
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
