import { verifySession } from '@/lib/session'
import { getNotificationsForUser } from '@/lib/notifications'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const result = await getNotificationsForUser(session.userId, session.role)
  return Response.json(result)
}
