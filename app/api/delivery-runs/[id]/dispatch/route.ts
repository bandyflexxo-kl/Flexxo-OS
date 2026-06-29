import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendWhatsAppToGroup, isBridgeConfigured } from '@/lib/whatsappClient'

/**
 * Dispatch a draft run to the private-partner WhatsApp group, then move its orders to
 * Delivering. Sends from the dispatching admin's own WhatsApp session (they must be in
 * the partner group). If the bridge isn't configured or the send fails, the run is
 * still marked dispatched and the message is returned for one-tap copy into the group.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { groupJid?: string }

  const run = await prisma.deliveryRun.findUnique({
    where:  { id },
    include: { stops: { select: { orderId: true } } },
  })
  if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })
  if (run.status === 'dispatched')
    return Response.json({ error: 'Run already dispatched' }, { status: 409 })
  if (!run.messageText)
    return Response.json({ error: 'Run has no message to send' }, { status: 422 })

  const groupJid = (body.groupJid || process.env.WHATSAPP_PARTNER_GROUP_JID || '').trim()

  let sent = false
  let sendError: string | null = null
  if (groupJid && isBridgeConfigured()) {
    const res = await sendWhatsAppToGroup(session.userId, groupJid, run.messageText)
    sent = res.ok
    if (!res.ok) sendError = res.error
  } else {
    sendError = !groupJid
      ? 'No partner group set (WHATSAPP_PARTNER_GROUP_JID) — copy the message into the group.'
      : 'WhatsApp bridge not connected — copy the message into the group.'
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.$transaction([
    prisma.deliveryRun.update({
      where: { id },
      data:  { status: 'dispatched', sentAt: new Date(), partnerJid: groupJid || null },
    }),
    // Move each Packed order to Delivering (mirrors the Lalamove dispatch step).
    prisma.order.updateMany({
      where: { id: { in: run.stops.map(s => s.orderId) }, status: 'Packed' },
      data:  { status: 'Delivering' },
    }),
  ])

  return Response.json({ ok: true, sent, sendError, message: run.messageText })
}
