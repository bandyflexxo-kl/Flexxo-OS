import { z }                from 'zod'
import { verifySession }    from '@/lib/session'
import { prisma }           from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'

const schema = z.object({
  ids:    z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().min(1, 'Reason is required'),
})

/**
 * Bulk-reject pending_review quotations, returning them to draft.
 * Non-pending_review quotations in the list are silently skipped.
 */
export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role))
    return Response.json({ error: 'Only Managers, Directors and Admins can reject quotations.' }, { status: 403 })

  const body = await request.json()
  const result = schema.safeParse(body)
  if (!result.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { ids, reason } = result.data

  const qualifying = await prisma.quotation.findMany({
    where:  { id: { in: ids }, status: 'pending_review' },
    select: { id: true },
  })

  if (qualifying.length === 0)
    return Response.json({ rejected: 0, skipped: ids.length })

  await prisma.$transaction([
    prisma.quotation.updateMany({
      where: { id: { in: qualifying.map(q => q.id) } },
      data:  { status: 'draft' },
    }),
    ...qualifying.map(q =>
      prisma.quotationStatusHistory.create({
        data: {
          quotationId: q.id,
          fromStatus:  'pending_review',
          toStatus:    'draft',
          changedById: session.userId,
          notes:       `Bulk rejected: ${reason}`,
        },
      }),
    ),
  ])

  return Response.json({ rejected: qualifying.length, skipped: ids.length - qualifying.length })
}
