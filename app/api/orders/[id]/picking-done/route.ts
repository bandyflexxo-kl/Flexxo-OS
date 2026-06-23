import { verifySession }           from '@/lib/session'
import { prisma }                   from '@/lib/prisma'
import { bookLalamoveDelivery }     from '@/lib/fulfillment'
import { isLalamoveBookingWindow }  from '@/lib/orderStatus'
import { sendPushToUser }           from '@/lib/webpush'
import { isPrivilegedRole }         from '@/lib/authorization'
import { notifyByRole, esc }        from '@/lib/telegramBot'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Allow Warehouse role and Admin/Manager
  const allowed = session.role === 'Warehouse' || isPrivilegedRole(session.role)
  if (!allowed) return Response.json({ error: 'Warehouse, Manager, or Admin required' }, { status: 403 })

  const { id } = await params

  const order = await prisma.order.findUnique({
    where:   { id },
    include: { warehouseTask: true },
  })

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'Approved' && order.status !== 'Picking') {
    return Response.json({ error: `Order is ${order.status}, expected Approved or Picking.` }, { status: 409 })
  }
  if (!order.warehouseTask) {
    return Response.json({ error: 'No warehouse task found for this order.' }, { status: 404 })
  }

  // Mark task done + move order to Packed
  await prisma.$transaction(async tx => {
    await tx.warehouseTask.update({
      where: { id: order.warehouseTask!.id },
      data:  { status: 'done', completedAt: new Date(), completedById: session.userId },
    })

    await tx.order.update({
      where: { id },
      data:  { status: 'Packed' },
    })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} packed — ready for delivery`,
        body:         `Picking completed by ${session.name}`,
        userId:       session.userId,
      },
    })
  })

  const orderRef = order.referenceNo ?? id

  // Push + Telegram → Admin/Manager/Director: packed, book delivery
  const managers = await prisma.userRole.findMany({
    where:   { role: { name: { in: ['Admin', 'Manager'] } }, revokedAt: null },
    include: { user: { select: { id: true } } },
  })
  for (const m of managers) {
    sendPushToUser(m.user.id, {
      title: '📦 Order Packed',
      body:  `${orderRef} is packed and waiting for delivery booking`,
      url:   `/orders/${id}`,
    }).catch(() => undefined)
  }
  notifyByRole(
    ['Admin', 'Director', 'Manager'],
    `📦 <b>${esc(orderRef)} packed — ready for delivery!</b>\n\n` +
    `Picking done by ${esc(session.name ?? session.email)}.\n\n` +
    `Reply <code>/book ${esc(orderRef)}</code> to get a Lalamove quote.`,
  ).catch(() => undefined)

  // If we're inside a Lalamove booking window, book immediately
  let bookedNow = false
  let shareLink: string | undefined

  if (isLalamoveBookingWindow()) {
    const result = await bookLalamoveDelivery(id)
    if (result.ok) {
      bookedNow = true
      shareLink = result.shareLink
    }
  }

  return Response.json({ ok: true, bookedNow, shareLink })
}
