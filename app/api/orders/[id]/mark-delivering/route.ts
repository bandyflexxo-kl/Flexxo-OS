import { verifySession }          from '@/lib/session'
import { prisma }                  from '@/lib/prisma'
import { isPrivilegedRole }        from '@/lib/authorization'
import { sendPushToUser }          from '@/lib/webpush'
import { stageQneDeliveryOrder }   from '@/lib/fulfillment'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().optional(),  // e.g. "Driver: Ahmad, Plate: VDA 1234"
})

/**
 * POST /api/orders/[id]/mark-delivering
 *
 * Admin / Manager manually marks a Packed order as Delivering.
 * Used when delivery is done manually (own transport, not Lalamove).
 * Notifies the salesperson.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },           { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const order = await prisma.order.findUnique({
    where:   { id },
    include: {
      company:   { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  })

  if (!order)                    return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'Packed') {
    return Response.json(
      { error: `Order must be Packed to start delivering. Current: ${order.status}` },
      { status: 409 },
    )
  }

  await prisma.$transaction(async tx => {
    await tx.order.update({ where: { id }, data: { status: 'Delivering' } })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} — Out for Delivery (manual)`,
        body:         parsed.data.notes ?? `Marked delivering by ${session.name} (manual transport).`,
        userId:       session.userId,
      },
    })
  })

  // ── Stage the Delivery Order in the QNE simulation layer ─────────────────
  const doNo = await stageQneDeliveryOrder(id, session.name ?? session.email)

  // ── Notify salesperson (fire-and-forget) ─────────────────────────────────
  if (order.createdById && order.createdById !== session.userId) {
    sendPushToUser(order.createdById, {
      title: '🚚 Out for Delivery',
      body:  `${order.referenceNo ?? id} (${order.company.name}) is on the way.`,
      url:   `/orders/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'Delivering', qneDoStaged: doNo })
}
