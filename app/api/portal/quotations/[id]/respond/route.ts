import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'
import { z } from 'zod'

const Schema = z.object({
  action: z.enum(['accept', 'decline']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid action.' }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true, companyId: true },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = assertPortalCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  if (quotation.status !== 'sent') {
    return Response.json({ error: 'This quotation cannot be responded to in its current status.' }, { status: 409 })
  }

  const newStatus = parsed.data.action === 'accept' ? 'accepted' : 'declined'

  await prisma.$transaction([
    prisma.quotation.update({ where: { id }, data: { status: newStatus } }),
    prisma.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'sent',
        toStatus:    newStatus,
        changedById: session.userId,
        notes:       `Customer ${parsed.data.action}d via portal`,
      },
    }),
  ])

  return Response.json({ ok: true, status: newStatus })
}
