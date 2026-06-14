import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  reason: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: stagingId } = await params
  const body = await request.json() as unknown
  const parsed = Schema.safeParse(body)

  const staging = await prisma.supplierPriceStaging.findUnique({ where: { id: stagingId } })
  if (!staging) return Response.json({ error: 'Staging row not found' }, { status: 404 })
  if (staging.stagingStatus !== 'pending_review') {
    return Response.json({ error: 'This row has already been reviewed.' }, { status: 409 })
  }

  await prisma.supplierPriceStaging.update({
    where: { id: stagingId },
    data: {
      stagingStatus:   'rejected',
      rejectionReason: parsed.success ? (parsed.data.reason ?? null) : null,
      reviewedById:    session.userId,
      reviewedAt:      new Date(),
    },
  })

  return Response.json({ ok: true })
}
