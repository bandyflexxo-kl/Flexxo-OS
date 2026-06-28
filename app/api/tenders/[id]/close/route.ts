/**
 * POST /api/tenders/[id]/close — manual close (never automatic, per spec).
 * Purchaser / Manager / Director / SuperAdmin. Sets stage=closed, status=won.
 * Body: { status?: 'won' | 'lost' | 'cancelled' } (default 'won').
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canManageGate, canActOnStage } from '@/lib/tenderAccess'
import { recordAmendment } from '@/lib/tenderAmendment'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageGate(session.role) && !canActOnStage(session.role, 'supplier_po')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const status = z.object({ status: z.enum(['won', 'lost', 'cancelled']).optional() })
    .safeParse(await req.json().catch(() => ({}))).data?.status ?? 'won'

  const tender = await prisma.tender.findUnique({ where: { id }, select: { stage: true } })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage === 'closed') return Response.json({ error: 'Already closed.' }, { status: 409 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.tender.update({ where: { id }, data: { stage: 'closed', status } })
  await recordAmendment(prisma, {
    tenderId: id, field: 'stage', before: tender.stage, after: 'closed',
    reason: `Tender closed (${status})`, changedById: session.userId, approvedById: session.userId,
  })
  return Response.json({ ok: true, stage: 'closed', status })
}
