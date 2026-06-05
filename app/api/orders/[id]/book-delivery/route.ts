import { verifySession }        from '@/lib/session'
import { isPrivilegedRole }      from '@/lib/authorization'
import { bookLalamoveDelivery }  from '@/lib/fulfillment'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Allow Admin/Manager OR cron (CRON_SECRET header)
  const cronSecret = _request.headers.get('Authorization')
  const isCron     = cronSecret === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const session = await verifySession().catch(() => null)
    if (!session)                        return Response.json({ error: 'Unauthorized' },  { status: 401 })
    if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })
  }

  const { id } = await params
  const result = await bookLalamoveDelivery(id)

  if (!result.ok) return Response.json({ error: result.error }, { status: 422 })

  return Response.json({ ok: true, bookingId: result.bookingId, shareLink: result.shareLink })
}
