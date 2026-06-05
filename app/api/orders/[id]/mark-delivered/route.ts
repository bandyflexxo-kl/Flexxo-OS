import { verifySession }           from '@/lib/session'
import { prisma }                   from '@/lib/prisma'
import { isPrivilegedRole }         from '@/lib/authorization'
import { sendGoogleReviewRequest }  from '@/lib/fulfillment'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Allow Admin/Manager OR Lalamove webhook (LALAMOVE_WEBHOOK_SECRET header)
  const webhookSecret = request.headers.get('X-Lalamove-Signature')
  const isWebhook     = webhookSecret && webhookSecret === process.env.LALAMOVE_WEBHOOK_SECRET

  let actorName = 'Lalamove webhook'

  if (!isWebhook) {
    const session = await verifySession().catch(() => null)
    if (!session)                        return Response.json({ error: 'Unauthorized' },  { status: 401 })
    if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })
    actorName = session.name ?? session.email
  }

  const { id } = await params

  const order = await prisma.order.findUnique({
    where: { id },
    select: { status: true, companyId: true, referenceNo: true, createdById: true },
  })

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'Delivered') return Response.json({ ok: true, alreadyDelivered: true })

  await prisma.$transaction(async tx => {
    await tx.order.update({
      where: { id },
      data:  { status: 'Delivered', deliveredAt: new Date() },
    })

    // Update delivery booking if it exists
    await tx.deliveryBooking.updateMany({
      where: { orderId: id, bookingStatus: { in: ['booked', 'driver_assigned'] } },
      data:  { bookingStatus: 'completed' },
    })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} delivered`,
        body:         `Marked delivered by ${actorName}`,
        userId:       order.createdById,
      },
    })
  })

  // Fire-and-forget post-delivery automations
  sendGoogleReviewRequest(id).catch(() => undefined)

  // Create 30-day reorder follow-up activity for salesperson
  createReorderFollowUp(id, order.companyId, order.createdById, order.referenceNo).catch(() => undefined)

  return Response.json({ ok: true })
}

async function createReorderFollowUp(
  orderId:    string,
  companyId:  string,
  salesRepId: string,
  orderRef:   string | null,
): Promise<void> {
  const followUpAt = new Date()
  followUpAt.setDate(followUpAt.getDate() + 30)

  await prisma.activity.create({
    data: {
      companyId,
      activityType:   'follow_up',
      subject:        `Reorder check-in — ${orderRef ?? orderId}`,
      body:           'Follow up to check if the client needs to reorder. This was auto-created 30 days after delivery.',
      followUpAt,
      followUpStatus: 'Pending',
      userId:         salesRepId,
    },
  })
}
