import { prisma } from '@/lib/prisma'

export type TierRates = { low: number; mid: number; high: number }

export const DEFAULT_TIER_RATES: TierRates = { low: 30, mid: 25, high: 20 }

/**
 * Tiered gross-margin pricing — sell = cost / (1 - margin%)
 * Rounded up to nearest 10 cents.
 *
 *   cost ≤  0.99  → low  margin (default 30%)
 *   cost  1.00–2.99 → mid  margin (default 25%)
 *   cost ≥  3.00  → high margin (default 20%)
 */
export function tieredSellingPrice(cost: number, rates: TierRates = DEFAULT_TIER_RATES): string {
  if (cost <= 0) return '0.00'
  const marginPct = cost <= 0.99 ? rates.low : cost <= 2.99 ? rates.mid : rates.high
  const raw = cost / (1 - marginPct / 100)
  return (Math.ceil(raw * 10) / 10).toFixed(2)
}

/** Fetch admin-configured tier rates from SystemSettings (falls back to defaults). */
export async function getTierRates(): Promise<TierRates> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['tier_margin_low_pct', 'tier_margin_mid_pct', 'tier_margin_high_pct'] } },
  })
  const m = Object.fromEntries(rows.map(s => [s.key, parseFloat(s.value)]))
  return {
    low:  isFinite(m['tier_margin_low_pct'])  ? m['tier_margin_low_pct']  : DEFAULT_TIER_RATES.low,
    mid:  isFinite(m['tier_margin_mid_pct'])  ? m['tier_margin_mid_pct']  : DEFAULT_TIER_RATES.mid,
    high: isFinite(m['tier_margin_high_pct']) ? m['tier_margin_high_pct'] : DEFAULT_TIER_RATES.high,
  }
}
