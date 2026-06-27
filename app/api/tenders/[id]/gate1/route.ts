/**
 * POST /api/tenders/[id]/gate1
 * Sales Manager (or Director/SuperAdmin) acknowledges Gate 1, unlocking
 * Stage 2 (RFQ). Marks the Gate-1 ApprovalRequest approved and advances the
 * tender stage creation → rfq.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canManageGate } from '@/lib/tenderAccess'
import { recordAmendment } from '@/lib/tenderAmendment'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageGate(session.role)) return Response.json({ error: 'Forbidden — gate keepers only' }, { status: 403 })

  const { id } = await params
  const tender = await prisma.tender.findUnique({ where: { id } })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'creation') {
    return Response.json({ error: 'Gate 1 already cleared for this tender.' }, { status: 409 })
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  if (tender.gate1ApprovalId) {
    await prisma.approvalRequest.update({
      where: { id: tender.gate1ApprovalId },
      data: {
        status:        'approved',
        assignedToId:  session.userId,
        reviewedAt:    new Date(),
        reviewerNotes: 'Gate 1 acknowledged',
      },
    })
  }
  await prisma.tender.update({ where: { id }, data: { stage: 'rfq' } })
  await recordAmendment(prisma, {
    tenderId: id, field: 'stage', before: 'creation', after: 'rfq',
    reason: 'Gate 1 acknowledged', changedById: session.userId, approvedById: session.userId,
  })

  return Response.json({ ok: true, stage: 'rfq' })
}
