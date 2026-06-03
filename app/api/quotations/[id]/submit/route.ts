import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'

/** Salesperson submits a draft quotation for manager approval. draft → pending_review */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // B2B clients cannot submit quotations
  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true, companyId: true },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  if (quotation.status !== 'draft') {
    return Response.json(
      { error: `Only draft quotations can be submitted. Current status: ${quotation.status}` },
      { status: 400 },
    )
  }

  const itemCount = await prisma.quotationItem.count({ where: { quotationId: id } })
  if (itemCount === 0) {
    return Response.json({ error: 'Add at least one item before submitting.' }, { status: 400 })
  }

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'pending_review' },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'draft',
        toStatus:    'pending_review',
        changedById: session.userId,
        notes:       'Submitted for approval',
      },
    })
  })

  return Response.json({ ok: true, status: 'pending_review' })
}
