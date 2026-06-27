/**
 * POST /api/tenders/[id]/gate2
 * Gate 2 — Sales Manager records that the client awarded the job to Flexxo,
 * unlocking Stage 3 (evaluation). Enforces the optional min-quotes rule
 * (override with { force: true }). Optionally creates the QNE Project if
 * tender writes are enabled (best-effort; never blocks the award).
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canManageGate } from '@/lib/tenderAccess'
import { recordAmendment } from '@/lib/tenderAmendment'
import { getTenderSettings } from '@/lib/tenderSettings'
import { createQneTenderProject } from '@/lib/qneTender'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageGate(session.role)) return Response.json({ error: 'Forbidden — gate keepers only' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const force = z.object({ force: z.boolean().optional() }).safeParse(body).data?.force ?? false

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: { vendors: { select: { replyStatus: true } } },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'rfq') {
    return Response.json({ error: 'Gate 2 is only available after Gate 1, during the RFQ stage.' }, { status: 409 })
  }

  // Min-quotes rule (optional per tender)
  const priceReceived = tender.vendors.filter(v => v.replyStatus === 'price_received').length
  if (tender.minQuotesRequired && priceReceived < tender.minQuotesRequired && !force) {
    return Response.json({
      warning: 'min_quotes',
      message: `Only ${priceReceived} of ${tender.minQuotesRequired} required supplier quotes received. Confirm to proceed anyway.`,
      priceReceived,
      required: tender.minQuotesRequired,
    }, { status: 409 })
  }

  // Optional QNE Project creation (best-effort, flag-gated)
  let qneProjectCode: string | null = null
  let qneNote: string | null = null
  const settings = await getTenderSettings()
  if (settings.qneWritesEnabled) {
    try {
      qneProjectCode = await createQneTenderProject({
        refNo: tender.refNo, name: tender.name, estValue: tender.estValue ? Number(tender.estValue) : null,
        periodStart: tender.periodStart, periodEnd: tender.periodEnd,
      })
    } catch (e) {
      qneNote = e instanceof Error ? e.message : 'QNE project creation failed'
    }
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  const approval = await prisma.approvalRequest.create({
    data: {
      entityType: 'tender', entityId: id, actionRequested: 'gate2_award', status: 'approved',
      requestedById: session.userId, assignedToId: session.userId, reviewedAt: new Date(),
      reviewerNotes: 'Gate 2 — client award confirmed',
    },
  })
  await prisma.tender.update({
    where: { id },
    data: { stage: 'evaluation', gate2ApprovalId: approval.id, ...(qneProjectCode ? { qneProjectCode } : {}) },
  })
  await recordAmendment(prisma, {
    tenderId: id, field: 'stage', before: 'rfq', after: 'evaluation',
    reason: 'Gate 2 — client award', changedById: session.userId, approvedById: session.userId,
  })

  return Response.json({ ok: true, stage: 'evaluation', qneProjectCode, qneNote })
}
