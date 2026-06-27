import 'server-only'
import { prisma } from '@/lib/prisma'

export type SupplierScore = {
  supplierId:    string
  invited:       number   // times invited to a tender
  replied:       number   // times a price was received
  replyRate:     number   // 0..1
  avgReplyHours: number | null
  won:           number   // distinct tenders won (item awarded)
  stars:         number   // 1..5 quick signal (null-ish → 0)
}

/**
 * Lightweight, computed-on-demand supplier performance across all tenders.
 * Shown when selecting vendors for an RFQ. Heavier metrics (delivery
 * reliability) wait for Phases 4–5 once GRNs exist.
 */
export async function getSupplierScores(supplierIds: string[]): Promise<Map<string, SupplierScore>> {
  const result = new Map<string, SupplierScore>()
  if (supplierIds.length === 0) return result

  const [vendors, awardedItems] = await Promise.all([
    prisma.tenderVendor.findMany({
      where:  { supplierId: { in: supplierIds } },
      select: { supplierId: true, replyStatus: true, rfqSentAt: true, priceReceivedAt: true },
    }),
    prisma.tenderItem.findMany({
      where:  { awardedSupplierId: { in: supplierIds } },
      select: { awardedSupplierId: true, tenderId: true },
    }),
  ])

  // won = distinct tenders per supplier
  const wonSets = new Map<string, Set<string>>()
  for (const it of awardedItems) {
    if (!it.awardedSupplierId) continue
    const set = wonSets.get(it.awardedSupplierId) ?? new Set<string>()
    set.add(it.tenderId)
    wonSets.set(it.awardedSupplierId, set)
  }

  for (const sid of supplierIds) {
    const mine = vendors.filter(v => v.supplierId === sid)
    const invited = mine.length
    const replied = mine.filter(v => v.replyStatus === 'price_received').length
    const replyRate = invited > 0 ? replied / invited : 0

    const durations = mine
      .filter(v => v.rfqSentAt && v.priceReceivedAt)
      .map(v => (v.priceReceivedAt!.getTime() - v.rfqSentAt!.getTime()) / 3_600_000)
      .filter(h => h >= 0)
    const avgReplyHours = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null

    // stars: mostly reply rate, lightly boosted by having won
    const won = wonSets.get(sid)?.size ?? 0
    const stars = invited === 0 ? 0 : Math.max(1, Math.min(5, Math.round(replyRate * 4) + (won > 0 ? 1 : 0)))

    result.set(sid, { supplierId: sid, invited, replied, replyRate, avgReplyHours, won, stars })
  }
  return result
}
