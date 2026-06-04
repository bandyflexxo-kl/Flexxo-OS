import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { getSessionStatus } from '@/lib/whatsappClient'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params
  const state = await getSessionStatus(userId)
  return Response.json(state)
}
