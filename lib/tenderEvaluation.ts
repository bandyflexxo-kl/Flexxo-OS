/**
 * lib/tenderEvaluation.ts — pure evaluation logic for Stage 3.
 * No I/O: callers supply data, these compute variance, ranking, the
 * split-award suggestion, and margins. Keeps the math testable.
 */

export type QuoteCell = { tenderItemId: string; supplierId: string; quotedUnitPrice: number }
export type EvalItem = { id: string; qty: number; normalUnitPrice: number | null; targetPrice: number | null }

/** % a quoted price sits above (positive) / below (negative) the normal list price. */
export function variancePct(quoted: number, normal: number | null): number | null {
  if (normal == null || normal <= 0) return null
  return ((quoted - normal) / normal) * 100
}

/** Flagged when the quote is MORE than `threshold` % above the normal price. */
export function isFlagged(quoted: number, normal: number | null, threshold: number): boolean {
  const v = variancePct(quoted, normal)
  return v != null && v > threshold
}

export type VendorRank = { supplierId: string; itemsQuoted: number; total: number; rank: number }

/**
 * Rank suppliers by the total cost of the items they quoted (qty × quote).
 * Only items a supplier actually quoted count toward their total — a vendor who
 * quoted everything and a vendor who quoted one item are both shown with their
 * coverage (itemsQuoted) so the manager can judge fairly.
 */
export function rankVendors(items: EvalItem[], quotes: QuoteCell[]): VendorRank[] {
  const qtyById = new Map(items.map(i => [i.id, i.qty]))
  const byVendor = new Map<string, { total: number; items: Set<string> }>()
  for (const q of quotes) {
    const qty = qtyById.get(q.tenderItemId)
    if (qty == null) continue
    const agg = byVendor.get(q.supplierId) ?? { total: 0, items: new Set<string>() }
    agg.total += q.quotedUnitPrice * qty
    agg.items.add(q.tenderItemId)
    byVendor.set(q.supplierId, agg)
  }
  const rows = [...byVendor.entries()]
    .map(([supplierId, a]) => ({ supplierId, itemsQuoted: a.items.size, total: a.total, rank: 0 }))
    .sort((a, b) => a.total - b.total)
  rows.forEach((r, i) => { r.rank = i + 1 })
  return rows
}

export type OptimalPick = { tenderItemId: string; supplierId: string; quotedUnitPrice: number }

/** Lowest-cost vendor per item (the split-award suggestion). */
export function optimiseSplitAward(quotes: QuoteCell[]): OptimalPick[] {
  const best = new Map<string, OptimalPick>()
  for (const q of quotes) {
    const cur = best.get(q.tenderItemId)
    if (!cur || q.quotedUnitPrice < cur.quotedUnitPrice) {
      best.set(q.tenderItemId, { tenderItemId: q.tenderItemId, supplierId: q.supplierId, quotedUnitPrice: q.quotedUnitPrice })
    }
  }
  return [...best.values()]
}

/**
 * Margin for an awarded line: client target price is the sell side, the
 * awarded (tender) price is our buy cost. Returns null when target unknown.
 */
export function lineMargin(targetPrice: number | null, awardedUnitPrice: number, qty: number) {
  if (targetPrice == null || targetPrice <= 0) return { amount: null as number | null, pct: null as number | null }
  const amount = (targetPrice - awardedUnitPrice) * qty
  const pct = ((targetPrice - awardedUnitPrice) / targetPrice) * 100
  return { amount, pct }
}
