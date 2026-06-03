import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true, companyId: true },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!['draft', 'approved', 'pending_review'].includes(quotation.status)) {
    return Response.json({ error: `Cannot send a quotation with status "${quotation.status}".` }, { status: 400 })
  }

  // Check it has at least one item
  const itemCount = await prisma.quotationItem.count({ where: { quotationId: id } })
  if (itemCount === 0) {
    return Response.json({ error: 'Add at least one item before sending.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  const prevStatus = quotation.status

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'sent', sentAt: new Date() },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  prevStatus,
        toStatus:    'sent',
        changedById: session.userId,
      },
    })
  })

  return Response.json({ ok: true, status: 'sent' })
}
