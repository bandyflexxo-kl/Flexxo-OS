/**
 * POST /api/tenders/[id]/gate3
 * Gate 3 — confirm the client PO is in place, unlocking Stage 5 (supplier PO
 * issuance). Requires at least one client PO logged. Purchaser / Admin /
 * SuperAdmin or a gate keeper, stage = 'client_po'.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage, canManageGate } from '@/lib/tenderAccess'
import { recordAmendment } from '@/lib/tenderAmendment'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'client_po') && !canManageGate(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const tender = await prisma.tender.findUnique({ where: { id }, include: { _count: { select: { clientPOs: true } } } })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'client_po') return Response.json({ error: 'Gate 3 is only available during Stage 4 (client PO).' }, { status: 409 })
  if (tender._count.clientPOs === 0) return Response.json({ error: 'Log at least one client PO before confirming Gate 3.' }, { status: 409 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  const approval = await prisma.approvalRequest.create({
    data: {
      entityType: 'tender', entityId: id, actionRequested: 'gate3_client_po', status: 'approved',
      requestedById: session.userId, assignedToId: session.userId, reviewedAt: new Date(),
      reviewerNotes: 'Gate 3 — client PO confirmed',
    },
  })
  await prisma.tender.update({ where: { id }, data: { stage: 'supplier_po', gate3ApprovalId: approval.id } })
  await recordAmendment(prisma, {
    tenderId: id, field: 'stage', before: 'client_po', after: 'supplier_po',
    reason: 'Gate 3 — client PO confirmed', changedById: session.userId, approvedById: session.userId,
  })

  return Response.json({ ok: true, stage: 'supplier_po' })
}
