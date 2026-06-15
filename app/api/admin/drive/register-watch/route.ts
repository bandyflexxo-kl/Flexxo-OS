import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { registerDriveWatch, getDriveChannelState } from '@/lib/driveWatch'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const state = await getDriveChannelState()
  return Response.json({ state })
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  if (!user?.googleRefreshToken) {
    return Response.json({ error: 'Connect Google Drive first (Admin → Suppliers → Connect Drive).' }, { status: 403 })
  }

  try {
    const state = await registerDriveWatch(user.googleRefreshToken)
    return Response.json({ ok: true, expireAt: state.expireAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to register Drive watch'
    return Response.json({ error: msg }, { status: 500 })
  }
}
