/**
 * lib/qnePriceSync.ts
 * Syncs "last sale price" per product from QNE invoice history.
 *
 * Reads:  GET /api/SalesInvoices (top N invoices, most recent first)
 *         GET /api/SalesInvoices/{id} for line items
 * Writes: products.qne_last_sale_price + qne_last_sale_price_at
 *
 * Display formula: qneLastSalePrice × 1.20  (shown to ALL users, logged in or not)
 *
 * QNE READ-ONLY: this function only calls GET endpoints — never writes to QNE.
 */

import { prisma }              from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

// ── Types ────────────────────────────────────────────────────────────────────

type QneInvoice = {
  id:          string
  docNo?:      string
  docDate?:    string
  // other fields we don't need
}

type QneInvoiceListResponse = {
  data?:  QneInvoice[]
  items?: QneInvoice[]
} | QneInvoice[]

type QneInvoiceDetail = {
  id:               string
  docDate?:         string
  // line items may be in different shapes depending on QNE version
  items?:           QneInvoiceItem[]
  salesInvoiceItems?: QneInvoiceItem[]
  details?:         QneInvoiceItem[]
  invoiceDetails?:  QneInvoiceItem[]
  lines?:           QneInvoiceItem[]
}

type QneInvoiceItem = {
  itemCode?:    string
  stockCode?:   string
  code?:        string
  unitPrice?:   number
  price?:       number
  amount?:      number
  qty?:         number
  quantity?:    number
  docDate?:     string
  // other fields
}

export type PriceSyncResult = {
  ok:              boolean
  invoicesFetched: number
  productsUpdated: number
  skipped:         number   // items with no matching CRM product
  errors:          string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract line items from any QNE invoice detail response shape */
function extractItems(detail: QneInvoiceDetail): QneInvoiceItem[] {
  return (
    detail.items              ??
    detail.salesInvoiceItems  ??
    detail.details            ??
    detail.invoiceDetails     ??
    detail.lines              ??
    []
  )
}

/** Extract invoice list from any QNE list response shape */
function extractInvoiceList(resp: QneInvoiceListResponse): QneInvoice[] {
  if (Array.isArray(resp)) return resp
  if ('data'  in resp && Array.isArray(resp.data))  return resp.data
  if ('items' in resp && Array.isArray(resp.items)) return resp.items
  return []
}

/** Concurrency limiter — runs up to `limit` promises in parallel */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = []
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]()
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Fetches the last `maxInvoices` sales invoices from QNE, extracts item unit
 * prices, and updates products.qne_last_sale_price for matching items.
 *
 * Matching: invoice item.itemCode / stockCode / code → product.qneItemCode (exact, case-insensitive)
 * Price used: the most recent unit price found across all fetched invoices.
 *
 * If VPN is inactive, throws QneUnavailableError.
 */
export async function syncQnePrices(maxInvoices = 200): Promise<PriceSyncResult> {
  const errors: string[] = []

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const token = await qneLogin()

  // ── 2. Fetch invoice list (most recent first) ──────────────────────────────
  let invoices: QneInvoice[] = []
  try {
    const raw = await qneGet<QneInvoiceListResponse>('/SalesInvoices', token)
    const all  = extractInvoiceList(raw)
    invoices   = all.slice(0, maxInvoices)
  } catch (err) {
    if (err instanceof QneUnavailableError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to fetch invoice list: ${msg}`)
  }

  // ── 3. Fetch invoice details in parallel (15 concurrent) ──────────────────
  const detailTasks = invoices.map(inv => async (): Promise<{ docDate: string; items: QneInvoiceItem[] }> => {
    try {
      const detail = await qneGet<QneInvoiceDetail>(`/SalesInvoices/${inv.id}`, token)
      return {
        docDate: detail.docDate ?? inv.docDate ?? '',
        items:   extractItems(detail),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Invoice ${inv.id}: ${msg}`)
      return { docDate: '', items: [] }
    }
  })

  const details = await pLimit(detailTasks, 15)

  // ── 4. Build map: itemCode → { price, date } (most recent wins) ───────────
  //
  // Invoices are returned most-recent first from QNE.
  // We iterate in order — first occurrence of an itemCode wins (most recent).
  const priceMap = new Map<string, { price: number; date: string }>()

  for (const { docDate, items } of details) {
    for (const item of items) {
      const code = (
        item.itemCode ?? item.stockCode ?? item.code ?? ''
      ).trim().toUpperCase()
      if (!code) continue

      const price = item.unitPrice ?? item.price ?? (
        item.qty && item.amount ? item.amount / item.qty : 0
      )
      if (!price || price <= 0) continue

      // Only set if not already seen (first = most recent)
      if (!priceMap.has(code)) {
        priceMap.set(code, { price, date: docDate })
      }
    }
  }

  if (priceMap.size === 0) {
    return {
      ok:              true,
      invoicesFetched: invoices.length,
      productsUpdated: 0,
      skipped:         0,
      errors,
    }
  }

  // ── 5. Load products that have a qneItemCode ───────────────────────────────
  const products = await prisma.product.findMany({
    where:  { isActive: true, qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })

  // ── 6. Update matching products ────────────────────────────────────────────
  let productsUpdated = 0
  let skipped         = 0

  for (const product of products) {
    const code = (product.qneItemCode ?? '').trim().toUpperCase()
    const entry = priceMap.get(code)

    if (!entry) {
      skipped++
      continue
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        qneLastSalePrice:   entry.price,
        qneLastSalePriceAt: entry.date ? new Date(entry.date) : new Date(),
      },
    })
    productsUpdated++
  }

  return {
    ok:              true,
    invoicesFetched: invoices.length,
    productsUpdated,
    skipped:         products.length - productsUpdated,
    errors,
  }
}

/** The display price shown to all users = QNE last sale price × 1.20 */
export function calcDisplayPrice(qneLastSalePrice: number | null): number | null {
  if (!qneLastSalePrice || qneLastSalePrice <= 0) return null
  return Math.round(qneLastSalePrice * 1.20 * 100) / 100
}
