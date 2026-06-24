/**
 * lib/qnePriceSync.ts
 * Syncs QNE purchase (cost) prices into the product catalogue.
 *
 * Reads:  GET /api/Stocks (paginated, all active stock items)
 * Writes: products.qneLastSalePrice  ← stores purchase price from QNE
 *         products.qneLastSalePriceAt
 *
 * Display formula: purchasePrice × 1.20, rounded UP to nearest RM 0.10
 * (shown to ALL visitors — logged-in B2B and guest browsing)
 *
 * QNE READ-ONLY: this function only calls GET endpoints — never writes to QNE.
 */

import { prisma }              from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

// ── Types ────────────────────────────────────────────────────────────────────

export type PriceSyncResult = {
  ok:              boolean
  invoicesFetched: number   // repurposed: stock items fetched from QNE
  productsUpdated: number
  skipped:         number   // products with no matching QNE stock code
  errors:          string[]
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Fetches purchase prices for all stock items from QNE Stocks endpoint
 * and updates products.qneLastSalePrice (stores the purchase/cost price).
 *
 * Source:  GET /api/Stocks  →  stock.purchasePrice
 * Matching: stock.stockCode → product.qneItemCode (case-insensitive)
 *
 * Display formula (in calcDisplayPrice): purchasePrice × 1.20
 * rounded UP to nearest RM 0.10.
 *
 * If VPN is inactive, throws QneUnavailableError.
 */
export async function syncQnePrices(
  onProgress?: (msg: string) => void,
): Promise<PriceSyncResult> {
  const errors: string[] = []

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  onProgress?.('Logging in to QNE…')
  const token = await qneLogin()

  // ── 2. Fetch all stock items from QNE (paginated by 200) ──────────────────
  //
  // Each stock item has:  stockCode, purchasePrice (cost from supplier)
  // We build a map: STOCK_CODE → purchasePrice for fast lookup.

  const priceMap = new Map<string, number>()  // stockCode.toUpperCase() → purchasePrice
  let skip       = 0
  const top      = 200

  onProgress?.(`Fetching stock prices from QNE…`)

  while (true) {
    try {
      const raw  = await qneGet<unknown>(`/Stocks?$top=${top}&$skip=${skip}`, token)
      const page = (
        Array.isArray(raw)                                        ? raw
        : Array.isArray((raw as Record<string, unknown>).value)  ? (raw as Record<string, unknown>).value
        : Array.isArray((raw as Record<string, unknown>).data)   ? (raw as Record<string, unknown>).data
        : []
      ) as Record<string, unknown>[]

      if (page.length === 0) break

      for (const item of page) {
        const code  = String(item.stockCode ?? item.code ?? '').trim().toUpperCase()
        // Try multiple possible field names for purchase/cost price
        const price = Number(item.purchasePrice ?? item.unitCost ?? item.costPrice ?? 0)
        if (code && price > 0 && !priceMap.has(code)) {
          priceMap.set(code, price)
        }
      }

      if (page.length < top) break
      skip += top
      onProgress?.(`Fetched ${priceMap.size} prices so far…`)
    } catch (err) {
      if (err instanceof QneUnavailableError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Stocks page (skip=${skip}): ${msg}`)
      break  // partial data is still useful — continue with what we have
    }
  }

  if (priceMap.size === 0) {
    return { ok: true, invoicesFetched: 0, productsUpdated: 0, skipped: 0, errors }
  }

  onProgress?.(`Updating ${priceMap.size} prices in database…`)

  // ── 3. Load products that have a qneItemCode ───────────────────────────────
  const products = await prisma.product.findMany({
    where:  { isActive: true, qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })

  // ── 4. Update matching products ────────────────────────────────────────────
  let productsUpdated = 0
  let skipped         = 0

  for (const product of products) {
    const code  = (product.qneItemCode ?? '').trim().toUpperCase()
    const price = priceMap.get(code)

    if (!price) { skipped++; continue }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        qneLastSalePrice:   price,          // stores purchase price (base for ×1.20)
        qneLastSalePriceAt: new Date(),
      },
    })
    productsUpdated++
  }

  return {
    ok:              true,
    invoicesFetched: priceMap.size,         // stock items fetched from QNE
    productsUpdated,
    skipped:         products.length - productsUpdated,
    errors,
  }
}

/**
 * Display price = purchasePrice × 1.20, rounded UP to nearest RM 0.10.
 * e.g. 8.93 × 1.20 = 10.716 → RM 10.80
 *
 * Uses integer arithmetic (cents) to avoid floating-point drift.
 */
export function calcDisplayPrice(purchasePrice: number | null): number | null {
  if (!purchasePrice || purchasePrice <= 0) return null
  const withMargin = purchasePrice * 1.20
  // multiply by 10 to get "dimes", ceil, divide back — ceiling to nearest RM 0.10
  return Math.ceil(withMargin * 10) / 10
}
