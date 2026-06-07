import { verifySession }    from '@/lib/session'
import { prisma }            from '@/lib/prisma'
import { isPrivilegedRole }  from '@/lib/authorization'
import { sendPushToUser }    from '@/lib/webpush'
import { z } from 'zod'

const Schema = z.object({
  notes:         z.string().optional(),
  collectedByName: z.string().optional(),  // name of person who collected (if not the main contact)
})

/**
 * POST /api/orders/[id]/collected
 *
 * Admin / Manager confirms customer has collected the order in person.
 * Order: ReadyToCollect → Collected
 * Also creates a 30-day follow-up activity for the salesperson.
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

  if (!order)                              return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'ReadyToCollect') {
    return Response.json(
      { error: `Order must be ReadyToCollect to mark as Collected. Current: ${order.status}` },
      { status: 409 },
    )
  }

  const now           = new Date()
  const followUpDate  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30 days from now
  const collectedNote = parsed.data.collectedByName
    ? `Collected by ${parsed.data.collectedByName}. ${parsed.data.notes ?? ''}`.trim()
    : `Collected by customer. ${parsed.data.notes ?? ''}`.trim()

  await prisma.$transaction(async tx => {
    await tx.order.update({
      where: { id },
      data:  { status: 'Collected', deliveredAt: now },
    })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} — Collected by customer`,
        body:         collectedNote,
        userId:       session.userId,
      },
    })

    // 30-day reorder follow-up for salesperson
    if (order.createdById) {
      await tx.activity.create({
        data: {
          companyId:    order.companyId,
          activityType: 'follow_up',
          subject:      `Reorder check-in — ${order.company.name}`,
          body:         `Follow up on order ${order.referenceNo ?? id}. Check if they need to reorder supplies.`,
          userId:       order.createdById,
          followUpAt:   followUpDate,
        },
      })
    }
  })

  // ── Notify salesperson (fire-and-forget) ─────────────────────────────────
  if (order.createdById && order.createdById !== session.userId) {
    sendPushToUser(order.createdById, {
      title: '✅ Order Collected',
      body:  `${order.referenceNo ?? id} (${order.company.name}) collected. 30-day follow-up created.`,
      url:   `/orders/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'Collected' })
}
