/**
 * POST /api/tenders/[id]/quotes
 * Stage 3 — save the vendor quote matrix + per-item normal (Drive) prices.
 * Recomputes % variance and the over-threshold flag for every quote.
 * Manager / Director / SuperAdmin only, stage = 'evaluation'.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'
import { getTenderSettings } from '@/lib/tenderSettings'
import { variancePct, isFlagged } from '@/lib/tenderEvaluation'

const Body = z.object({
  normals: z.array(z.object({ tenderItemId: z.string().uuid(), normalUnitPrice: z.number().nonnegative().nullable() })).optional().default([]),
  quotes:  z.array(z.object({ tenderItemId: z.string().uuid(), supplierId: z.string().uuid(), quotedUnitPrice: z.number().nonnegative() })).optional().default([]),
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
    include: { items: { select: { id: true, normalUnitPrice: true } }, vendors: { select: { id: true, supplierId: true } } },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'evaluation') return Response.json({ error: 'Quotes can only be edited during the evaluation stage.' }, { status: 409 })
  if (tender.pricesLockedAt) return Response.json({ error: 'Prices are locked — quotes can no longer change.' }, { status: 409 })

  const itemIds = new Set(tender.items.map(i => i.id))
  const vendorBySupplier = new Map(tender.vendors.map(v => [v.supplierId, v.id]))
  const settings = await getTenderSettings()
  const threshold = tender.varianceThreshold != null ? Number(tender.varianceThreshold) : settings.varianceThreshold

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  // 1. Update normal prices (validate item belongs to tender)
  for (const n of parsed.data.normals) {
    if (!itemIds.has(n.tenderItemId)) continue
    await prisma.tenderItem.update({ where: { id: n.tenderItemId }, data: { normalUnitPrice: n.normalUnitPrice } })
  }

  // Re-read normals after update for accurate variance
  const normalById = new Map<string, number | null>()
  const freshItems = await prisma.tenderItem.findMany({ where: { tenderId: id }, select: { id: true, normalUnitPrice: true } })
  for (const it of freshItems) normalById.set(it.id, it.normalUnitPrice != null ? Number(it.normalUnitPrice) : null)

  // 2. Upsert quotes
  let saved = 0
  for (const q of parsed.data.quotes) {
    if (!itemIds.has(q.tenderItemId)) continue
    const tenderVendorId = vendorBySupplier.get(q.supplierId)
    if (!tenderVendorId) continue // supplier not an invited vendor
    const normal = normalById.get(q.tenderItemId) ?? null
    const vpct = variancePct(q.quotedUnitPrice, normal)
    const flagged = isFlagged(q.quotedUnitPrice, normal, threshold)
    await prisma.tenderVendorQuote.upsert({
      where:  { tenderItemId_tenderVendorId: { tenderItemId: q.tenderItemId, tenderVendorId } },
      update: { quotedUnitPrice: q.quotedUnitPrice, variancePct: vpct ?? undefined, flaggedOverThreshold: flagged },
      create: {
        tenderItemId: q.tenderItemId, tenderVendorId, supplierId: q.supplierId,
        quotedUnitPrice: q.quotedUnitPrice, variancePct: vpct ?? undefined, flaggedOverThreshold: flagged,
        enteredById: session.userId,
      },
    })
    saved++
  }

  return Response.json({ ok: true, saved, threshold })
}
