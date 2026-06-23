import { z }                       from 'zod'
import { verifySession }            from '@/lib/session'
import { isPrivilegedRole }          from '@/lib/authorization'
import { bookLalamoveDelivery }      from '@/lib/fulfillment'
import { prisma }                    from '@/lib/prisma'
import { notifyUser, esc }           from '@/lib/telegramBot'

const BodySchema = z.object({
  // Pre-fetched quote from GET /delivery-quote — pass through to skip a second Lalamove API call
  quoteId:     z.string().optional(),
  serviceType: z.string().optional(),
  priceMyr:    z.number().optional(),
}).optional()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Allow Admin/Manager/Director OR cron (CRON_SECRET header)
  const cronSecret = request.headers.get('Authorization')
  const isCron     = cronSecret === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const session = await verifySession().catch(() => null)
    if (!session)                        return Response.json({ error: 'Unauthorized' },  { status: 401 })
    if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })
  }

  const { id } = await params

  // Parse optional pre-fetched quote
  let preQuote: { quoteId: string; serviceType: string; priceMyr: number } | undefined
  const rawBody = await request.json().catch(() => null) as unknown
  const parsed  = BodySchema.safeParse(rawBody)
  if (parsed.success && parsed.data?.quoteId && parsed.data?.serviceType && parsed.data?.priceMyr !== undefined) {
    preQuote = {
      quoteId:     parsed.data.quoteId,
      serviceType: parsed.data.serviceType,
      priceMyr:    parsed.data.priceMyr,
    }
  }

  const result = await bookLalamoveDelivery(id, preQuote)

  if (!result.ok) return Response.json({ error: result.error }, { status: 422 })

  // Telegram → salesperson: delivery booked (fire-and-forget)
  ;(async () => {
    const order = await prisma.order.findUnique({ where: { id }, select: { companyId: true, referenceNo: true } })
    if (!order) return
    const assignment = await prisma.companyAssignment.findFirst({
      where:   { companyId: order.companyId, unassignedAt: null, isPrimary: true },
      select:  { userId: true },
      orderBy: { assignedAt: 'desc' },
    })
    if (!assignment) return
    await notifyUser(
      assignment.userId,
      `🚚 <b>${esc(order.referenceNo ?? id.slice(0, 8))}</b> delivery booked!\n` +
      (result.shareLink ? `Tracking: ${esc(result.shareLink)}` : ''),
    )
  })().catch(() => undefined)

  return Response.json({ ok: true, bookingId: result.bookingId, shareLink: result.shareLink })
}
