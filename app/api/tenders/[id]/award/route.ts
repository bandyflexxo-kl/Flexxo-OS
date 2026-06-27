/**
 * POST /api/tenders/[id]/award
 * Stage 3 finalisation — award a vendor per item, then LOCK all prices.
 * awardedUnitPrice is the negotiated tender (buy) price and is frozen here:
 * no role edits it afterwards (Super Admin override only, via amendment).
 *
 * Rules enforced:
 *  - every item must be awarded
 *  - awarded supplier must be an invited vendor with a quote on that item
 *  - if that quote is flagged (> variance threshold), a written overrideReason
 *    is MANDATORY before the award is accepted
 * Manager / Director / SuperAdmin only, stage = 'evaluation', not yet locked.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'
import { recordAmendment } from '@/lib/tenderAmendment'

const Body = z.object({
  awards: z.array(z.object({
    tenderItemId:     z.string().uuid(),
    supplierId:       z.string().uuid(),
    awardedUnitPrice: z.number().nonnegative(),
    overrideReason:   z.string().trim().min(3).optional().nullable(),
  })).min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'evaluation')) return Response.json({ error: 'Forbidden — evaluation is the Sales Manager stage' }, { status: 403 })

  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      items:   { select: { id: true } },
      vendors: { select: { id: true, supplierId: true } },
    },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'evaluation') return Response.json({ error: 'Award is only available during the evaluation stage.' }, { status: 409 })
  if (tender.pricesLockedAt) return Response.json({ error: 'Prices already locked.' }, { status: 409 })

  const itemIds = new Set(tender.items.map(i => i.id))
  const vendorBySupplier = new Map(tender.vendors.map(v => [v.supplierId, v.id]))

  // Every item must be awarded exactly once
  const awardedItemIds = new Set(parsed.data.awards.map(a => a.tenderItemId))
  if (awardedItemIds.size !== itemIds.size || ![...itemIds].every(i => awardedItemIds.has(i))) {
    return Response.json({ error: 'Every item must be awarded before prices can be locked.' }, { status: 400 })
  }

  // Validate each award + flag/override rule
  const quotes = await prisma.tenderVendorQuote.findMany({
    where: { tenderItem: { tenderId: id } },
    select: { id: true, tenderItemId: true, supplierId: true, flaggedOverThreshold: true },
  })
  const quoteKey = (i: string, s: string) => `${i}::${s}`
  const quoteMap = new Map(quotes.map(q => [quoteKey(q.tenderItemId, q.supplierId), q]))

  for (const a of parsed.data.awards) {
    if (!itemIds.has(a.tenderItemId)) return Response.json({ error: `Unknown item ${a.tenderItemId}` }, { status: 400 })
    if (!vendorBySupplier.has(a.supplierId)) return Response.json({ error: 'Awarded supplier is not an invited vendor.' }, { status: 400 })
    const q = quoteMap.get(quoteKey(a.tenderItemId, a.supplierId))
    if (!q) return Response.json({ error: 'Awarded supplier has no quote for one of the items.' }, { status: 400 })
    if (q.flaggedOverThreshold && (!a.overrideReason || a.overrideReason.trim().length < 3)) {
      return Response.json({ error: 'A written justification is required to award an item flagged above the variance threshold.', flaggedItemId: a.tenderItemId }, { status: 422 })
    }
  }

  // Apply (sequential — no interactive txn on the pooler)
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  for (const a of parsed.data.awards) {
    await prisma.tenderItem.update({
      where: { id: a.tenderItemId },
      data:  { awardedSupplierId: a.supplierId, awardedUnitPrice: a.awardedUnitPrice },
    })
    const q = quoteMap.get(quoteKey(a.tenderItemId, a.supplierId))!
    await prisma.tenderVendorQuote.update({
      where: { id: q.id },
      data:  { isAwarded: true, overrideReason: a.overrideReason ?? undefined },
    })
    if (a.overrideReason) {
      await recordAmendment(prisma, {
        tenderId: id, field: 'award_override', before: null, after: `item ${a.tenderItemId} → supplier ${a.supplierId}`,
        reason: a.overrideReason, changedById: session.userId, approvedById: session.userId,
      })
    }
  }

  await prisma.tender.update({
    where: { id },
    data:  { stage: 'client_po', pricesLockedAt: new Date(), pricesLockedById: session.userId },
  })
  await recordAmendment(prisma, {
    tenderId: id, field: 'stage', before: 'evaluation', after: 'client_po',
    reason: 'Prices awarded and locked', changedById: session.userId, approvedById: session.userId,
  })

  return Response.json({ ok: true, stage: 'client_po', lockedAt: new Date().toISOString() })
}
