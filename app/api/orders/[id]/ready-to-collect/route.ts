import { verifySession }    from '@/lib/session'
import { prisma }            from '@/lib/prisma'
import { isPrivilegedRole }  from '@/lib/authorization'
import { sendPushToUser }    from '@/lib/webpush'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().optional(),  // e.g. "Ready at counter, call customer"
})

/**
 * POST /api/orders/[id]/ready-to-collect
 *
 * Admin / Manager marks a Packed order as ReadyToCollect.
 * Used when customer will collect in person instead of delivery.
 * Notifies the salesperson who owns the order.
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

  if (!order)                     return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'Packed') {
    return Response.json(
      { error: `Order must be Packed to mark ReadyToCollect. Current: ${order.status}` },
      { status: 409 },
    )
  }

  await prisma.$transaction(async tx => {
    await tx.order.update({ where: { id }, data: { status: 'ReadyToCollect' } })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} — Ready to Collect`,
        body:         parsed.data.notes ?? `Marked ready for customer self-collection by ${session.name}.`,
        userId:       session.userId,
      },
    })
  })

  // ── Notify salesperson (fire-and-forget) ─────────────────────────────────
  if (order.createdById && order.createdById !== session.userId) {
    sendPushToUser(order.createdById, {
      title: '📦 Ready to Collect',
      body:  `${order.referenceNo ?? id} (${order.company.name}) — please notify customer to collect.`,
      url:   `/orders/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'ReadyToCollect' })
}
