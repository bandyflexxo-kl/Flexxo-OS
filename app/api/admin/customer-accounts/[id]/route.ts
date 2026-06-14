import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 })

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { isActive: false } }),
    prisma.userRole.updateMany({
      where: { userId: id, revokedAt: null },
      data:  { revokedAt: new Date() },
    }),
  ])

  return Response.json({ ok: true })
}
