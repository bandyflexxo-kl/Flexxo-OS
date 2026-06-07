import { verifySession }    from '@/lib/session'
import { prisma }            from '@/lib/prisma'
import { isPrivilegedRole }  from '@/lib/authorization'
import { z } from 'zod'

const Schema = z.object({
  action: z.enum(['approve', 'reject']),
  notes:  z.string().optional(),
})

/**
 * PATCH /api/admin/qne-sandbox/[id]
 * Approve or reject a pending QNE action.
 * Only Admin / Manager can act on these.
 *
 * approve — marks as approved (ready for manual entry in QNE)
 * reject  — marks as rejected (will not be entered in QNE)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },           { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const record = await prisma.qnePendingAction.findUnique({ where: { id } })
  if (!record)              return Response.json({ error: 'Record not found' }, { status: 404 })
  if (record.status !== 'pending') {
    return Response.json({ error: `Already ${record.status}.` }, { status: 409 })
  }

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected'

  await prisma.qnePendingAction.update({
    where: { id },
    data:  {
      status:      newStatus,
      notes:       parsed.data.notes ?? record.notes,
      approvedById: session.userId,
      approvedAt:  new Date(),
    },
  })

  return Response.json({ ok: true, status: newStatus })
}
