import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { disconnectUserSession } from '@/lib/whatsappClient'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params
  await disconnectUserSession(userId)
  return Response.json({ ok: true })
}
