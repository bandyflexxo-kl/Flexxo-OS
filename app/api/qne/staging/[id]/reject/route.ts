import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'

const Schema = z.object({ reason: z.string().optional() })

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/qne/staging/[id]/reject'>,
) {
  const session = await verifySession().catch(() => null)
  if (!session)                 return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' },    { status: 403 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { reason } = Schema.parse(body)

  const row = await prisma.qneCustomerStaging.findUnique({ where: { id } })
  if (!row)                                   return Response.json({ error: 'Not found' },        { status: 404 })
  if (row.stagingStatus !== 'pending_review') return Response.json({ error: 'Already reviewed' }, { status: 409 })

  await prisma.qneCustomerStaging.update({
    where: { id },
    data: {
      stagingStatus:   'rejected',
      rejectionReason: reason ?? null,
      reviewedById:    session.userId,
      reviewedAt:      new Date(),
    },
  })

  return Response.json({ id })
}
