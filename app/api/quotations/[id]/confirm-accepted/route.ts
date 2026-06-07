import { verifySession }   from '@/lib/session'
import { prisma }           from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendPushToUser }   from '@/lib/webpush'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().optional(),  // e.g. "Customer confirmed via WhatsApp at 3pm"
})

/**
 * POST /api/quotations/[id]/confirm-accepted
 *
 * Salesperson uses this when the customer verbally / via WhatsApp confirms
 * acceptance — without logging into the B2B portal.
 *
 * Creates the same Order as the portal accept route.
 * Only allowed on quotations with status 'sent'.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { select: { id: true, productId: true, qty: true, unitPrice: true, lineTotal: true } },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  if (quotation.status !== 'sent') {
    return Response.json(
      { error: `Can only confirm acceptance on a sent quotation. Current status: ${quotation.status}` },
      { status: 409 },
    )
  }

  let orderId: string
  let orderRef: string

  await prisma.$transaction(async tx => {
    await tx.quotation.update({ where: { id }, data: { status: 'accepted' } })

    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'sent',
        toStatus:    'accepted',
        changedById: session.userId,
        notes:       parsed.data.notes ?? `Confirmed accepted by salesperson ${session.name}`,
      },
    })

    const year     = new Date().getFullYear()
    const count    = await tx.order.count()
    orderRef = `ORD-${year}-${String(count + 1).padStart(4, '0')}`

    const order = await tx.order.create({
      data: {
        companyId:   quotation.companyId,
        quotationId: quotation.id,
        referenceNo: orderRef,
        source:      'Quotation',
        status:      'Confirmed',
        currency:    quotation.currency,
        totalAmount: quotation.totalAmount,
        createdById: session.userId,
      },
    })
    orderId = order.id

    if (quotation.items.length > 0) {
      await tx.orderItem.createMany({
        data: quotation.items.map(item => ({
          orderId:         order.id,
          productId:       item.productId,
          quotationItemId: item.id,
          qty:             item.qty,
          unitPrice:       item.unitPrice,
          lineTotal:       item.lineTotal,
        })),
      })
    }

    await tx.activity.create({
      data: {
        companyId:    quotation.companyId,
        activityType: 'note',
        direction:    'inbound',
        subject:      `Customer accepted quotation ${quotation.referenceNo} — order ${orderRef} created`,
        body:         parsed.data.notes ?? `Confirmed by ${session.name}`,
        userId:       session.userId,
      },
    })
  })

  // Push admin/manager: new order confirmed
  const managers = await prisma.userRole.findMany({
    where:   { role: { name: { in: ['Admin', 'Manager'] } }, revokedAt: null },
    include: { user: { select: { id: true } } },
  })
  for (const m of managers) {
    if (m.user.id !== session.userId) {
      sendPushToUser(m.user.id, {
        title: '🎉 New Order Confirmed',
        body:  `${orderRef!} created from ${quotation.referenceNo} — ready to approve.`,
        url:   `/orders/${orderId!}`,
      }).catch(() => undefined)
    }
  }

  return Response.json({ ok: true, status: 'accepted', orderId: orderId!, orderRef: orderRef! })
}
