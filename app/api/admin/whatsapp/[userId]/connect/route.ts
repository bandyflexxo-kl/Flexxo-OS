import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'
import { startSession } from '@/lib/whatsappClient'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await params

  try {
    const state = await startSession(userId)
    return Response.json(state)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bridge error'
    return Response.json({ error: msg }, { status: 502 })
  }
}
