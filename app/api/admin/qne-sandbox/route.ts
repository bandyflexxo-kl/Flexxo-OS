import { verifySession }    from '@/lib/session'
import { prisma }            from '@/lib/prisma'
import { isPrivilegedRole }  from '@/lib/authorization'

/**
 * GET /api/admin/qne-sandbox
 * Returns all QnePendingAction records (newest first).
 * Admin / Manager only.
 */
export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },           { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const statusFilter     = searchParams.get('status') ?? undefined   // pending | approved | rejected | all

  const items = await prisma.qnePendingAction.findMany({
    where:   statusFilter && statusFilter !== 'all' ? { status: statusFilter } : undefined,
    include: { approvedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take:    200,
  })

  return Response.json({ items })
}
