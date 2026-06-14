/**
 * lib/qneStock.ts
 * On-demand live stock lookup from QNE for a specific set of item codes.
 *
 * Used at the "proceed / Sales Order" gate (Phase 5) to re-verify availability
 * just before committing an order, since the nightly sync
 * (lib/qneStockSync.ts → products.qneAvailableQty) can be a few hours stale.
 *
 * QNE READ-ONLY: only calls GET endpoints.
 */

import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

/** Map of itemCode (UPPERCASE) → available quantity. Codes not found are absent. */
export type LiveStockMap = Map<string, number>

function readQty(item: Record<string, unknown>): number {
  const raw =
    item.available ??
    item.availableQty ??
    item.balanceQty ??
    item.qtyOnHand ??
    item.balance ??
    item.quantity ??
    item.qty ??
    0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function readCode(item: Record<string, unknown>): string {
  return String(item.stockCode ?? item.code ?? item.itemCode ?? '').trim().toUpperCase()
}

/**
 * Fetch live available quantities for the given QNE item codes.
 *
 * Pages through GET /api/Stocks/available and keeps only the requested codes.
 * Returns a Map keyed by UPPERCASE item code. Quantities for the same code
 * across multiple rows (e.g. locations) are summed.
 *
 * Throws QneUnavailableError when the VPN/host is unreachable so callers can
 * decide whether to block or fall back to the cached qneAvailableQty.
 */
export async function getLiveStockQty(itemCodes: string[]): Promise<LiveStockMap> {
  const wanted = new Set(itemCodes.map(c => c.trim().toUpperCase()).filter(Boolean))
  const result: LiveStockMap = new Map()
  if (wanted.size === 0) return result

  const token = await qneLogin()
  let   skip  = 0
  const top   = 200

  while (true) {
    let page: Record<string, unknown>[]
    try {
      const raw = await qneGet<unknown>(`/Stocks/available?$top=${top}&$skip=${skip}`, token)
      page = (
        Array.isArray(raw)                                       ? raw
        : Array.isArray((raw as Record<string, unknown>).value)  ? (raw as Record<string, unknown>).value
        : Array.isArray((raw as Record<string, unknown>).data)   ? (raw as Record<string, unknown>).data
        : []
      ) as Record<string, unknown>[]
    } catch (err) {
      if (err instanceof QneUnavailableError) throw err
      break  // non-fatal — return what we have so far
    }

    if (page.length === 0) break

    for (const item of page) {
      const code = readCode(item)
      if (!code || !wanted.has(code)) continue
      result.set(code, (result.get(code) ?? 0) + readQty(item))
    }

    // Stop early once every requested code is found.
    if (result.size >= wanted.size) break
    if (page.length < top) break
    skip += top
  }

  return result
}
