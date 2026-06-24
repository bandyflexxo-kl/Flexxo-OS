/**
 * lib/qneStockSync.ts
 * Syncs QNE available stock quantities into the product catalogue.
 *
 * Reads:  GET /api/Stocks/available (paginated, live stock balances)
 * Writes: products.qneAvailableQty   ← available quantity from QNE
 *         products.qneStockSyncedAt
 *
 * Shop visibility gate (lib/products-api.ts): a product is shown only when
 * isActive && isVisibleToCustomers && (qneAvailableQty ?? 0) > 0.
 *
 * QNE READ-ONLY: this function only calls GET endpoints — never writes to QNE.
 */

import { prisma }                                  from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError }   from '@/lib/qneClient'

// ── Types ────────────────────────────────────────────────────────────────────

export type StockSyncResult = {
  ok:             boolean
  stocksFetched:  number   // stock balance rows fetched from QNE
  productsUpdated: number  // products whose qneAvailableQty changed/was set
  zeroed:         number   // products with a QNE match but 0 available
  skipped:        number   // products with no matching QNE stock code
  errors:         string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * QNE stock-balance rows vary in field naming across endpoints/builds.
 * Pull the available quantity from whichever field is present.
 */
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

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Fetches available stock for all items from QNE and updates
 * products.qneAvailableQty. Matching: stock.stockCode → product.qneItemCode
 * (case-insensitive), same as lib/qnePriceSync.ts.
 *
 * If VPN is inactive, throws QneUnavailableError.
 */
export async function syncQneStock(onProgress?: (msg: string) => void): Promise<StockSyncResult> {
  const errors: string[] = []

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  onProgress?.('Logging in for stock sync…')
  const token = await qneLogin()

  // ── 2. Fetch all stock balances from QNE ────────────────────────────────────
  onProgress?.('Fetching stock balances from QNE…')
  // /Stocks/available returns all balances in one flat call — no pagination params.
  // Build a map: STOCK_CODE → availableQty, summing across multiple warehouse locations.
  const qtyMap = new Map<string, number>()

  try {
    const raw  = await qneGet<unknown>('/Stocks/available', token)
    const page = (
      Array.isArray(raw)                                       ? raw
      : Array.isArray((raw as Record<string, unknown>).value)  ? (raw as Record<string, unknown>).value
      : Array.isArray((raw as Record<string, unknown>).data)   ? (raw as Record<string, unknown>).data
      : []
    ) as Record<string, unknown>[]

    for (const item of page) {
      const code = readCode(item)
      if (!code) continue
      // Sum if a code appears in multiple locations/warehouses
      qtyMap.set(code, (qtyMap.get(code) ?? 0) + readQty(item))
    }
  } catch (err) {
    if (err instanceof QneUnavailableError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Stocks/available: ${msg}`)
  }

  if (qtyMap.size === 0) {
    return { ok: true, stocksFetched: 0, productsUpdated: 0, zeroed: 0, skipped: 0, errors }
  }

  // ── 3. Load products that have a qneItemCode ───────────────────────────────
  onProgress?.(`Fetched ${qtyMap.size} stock balances — updating products…`)
  const products = await prisma.product.findMany({
    where:  { isActive: true, qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })

  // ── 4. Update matching products ────────────────────────────────────────────
  const now = new Date()
  let productsUpdated = 0
  let zeroed          = 0
  let skipped         = 0

  for (const product of products) {
    const code = (product.qneItemCode ?? '').trim().toUpperCase()
    if (!qtyMap.has(code)) { skipped++; continue }

    const qty = Math.max(0, Math.round(qtyMap.get(code) ?? 0))
    await prisma.product.update({
      where: { id: product.id },
      data:  { qneAvailableQty: qty, qneStockSyncedAt: now },
    })
    productsUpdated++
    if (qty === 0) zeroed++
  }

  return {
    ok:              true,
    stocksFetched:   qtyMap.size,
    productsUpdated,
    zeroed,
    skipped,
    errors,
  }
}
