/**
 * lib/qnePortfolio.ts
 * Syncs two datasets from QNE into our DB (READ-ONLY from QNE):
 *   1. Outstanding balances  — from GET /Customers (currentBalance field)
 *   2. Top recurring items   — from GET /SalesInvoices + GET /SalesInvoices/{id}
 *
 * Results are cached in:
 *   companies.outstandingBalance / outstandingUpdatedAt
 *   qne_top_items  (model QneTopItem)
 *
 * Throws QneUnavailableError if VPN is not active.
 */

import { prisma } from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'

export { QneUnavailableError }

// ── Raw QNE shapes ────────────────────────────────────────────────────────────

type RawCustomer = {
  id:              string
  companyCode:     string
  currentBalance?: number | null
  [key: string]:   unknown
}

type RawInvoiceHeader = {
  id?:           string | null
  invoiceCode?:  string | null
  invoiceDate?:  string | null
  customer?:     string | null    // companyCode
  totalAmount?:  number | null
  isCancelled?:  boolean
  [key: string]: unknown
}

type RawInvoiceItem = {
  itemCode?:    string | null
  description?: string | null
  itemName?:    string | null
  qty?:         number | null
  quantity?:    number | null
  unitQty?:     number | null
  [key: string]: unknown
}

type RawInvoiceDetail = {
  invoiceCode?: string | null
  customer?:    string | null
  invoiceDate?: string | null
  isCancelled?: boolean
  // QNE uses various field names for line items:
  items?:               RawInvoiceItem[] | null
  salesInvoiceItems?:   RawInvoiceItem[] | null
  details?:             RawInvoiceItem[] | null
  invoiceDetails?:      RawInvoiceItem[] | null
  lines?:               RawInvoiceItem[] | null
  [key: string]:        unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract line items from any QNE invoice detail shape */
function extractItems(detail: RawInvoiceDetail): RawInvoiceItem[] {
  return (
    detail.items              ??
    detail.salesInvoiceItems  ??
    detail.details            ??
    detail.invoiceDetails     ??
    detail.lines              ??
    []
  )
}

/** Get item name from a line item */
function itemName(item: RawInvoiceItem): string {
  return (item.description ?? item.itemName ?? '').trim()
}

/** Get qty from a line item */
function itemQty(item: RawInvoiceItem): number {
  return Number(item.qty ?? item.quantity ?? item.unitQty ?? 1)
}

/** Run N async tasks at most `concurrency` at a time */
async function pLimit<T>(
  tasks:       (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

// ── Public API ────────────────────────────────────────────────────────────────

export type PortfolioSyncResult = {
  balancesUpdated:  number
  itemsUpdated:     number
  invoicesFetched:  number
  errors:           string[]
}

/**
 * syncPortfolio
 * Pulls outstanding balances + top items from QNE and persists to DB.
 * Safe to call at any time — purely read from QNE, upsert to our DB.
 *
 * @param maxInvoices  Cap on invoice headers to fetch (default 500, ~100s sync time)
 */
export async function syncPortfolio(maxInvoices = 500): Promise<PortfolioSyncResult> {
  const errors: string[] = []
  let balancesUpdated = 0
  let itemsUpdated = 0
  let invoicesFetched = 0

  const token = await qneLogin().catch(err => {
    throw new QneUnavailableError(
      `Cannot reach QNE (is Radmin VPN active?): ${err instanceof Error ? err.message : String(err)}`
    )
  })

  // ── 1. Sync outstanding balances ──────────────────────────────────────────
  try {
    const raw = await qneGet<unknown>('/Customers', token)
    const all: RawCustomer[] = Array.isArray(raw)
      ? (raw as RawCustomer[])
      : ((raw as { value?: RawCustomer[] })?.value ?? [])

    // Build a map: companyCode → currentBalance
    const balanceMap = new Map<string, number>()
    for (const c of all) {
      if (c.companyCode) {
        balanceMap.set(c.companyCode, Number(c.currentBalance ?? 0))
      }
    }

    // Update companies that have a qneCustomerCode
    const companies = await prisma.company.findMany({
      where:  { qneCustomerCode: { not: null } },
      select: { id: true, qneCustomerCode: true },
    })

    const now = new Date()
    for (const co of companies) {
      const code = co.qneCustomerCode!
      if (balanceMap.has(code)) {
        await prisma.company.update({
          where: { id: co.id },
          data: {
            outstandingBalance:   balanceMap.get(code),
            outstandingUpdatedAt: now,
          },
        })
        balancesUpdated++
      }
    }
  } catch (err) {
    if (err instanceof QneUnavailableError) throw err
    errors.push(`Balance sync error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 2. Sync top recurring items ───────────────────────────────────────────
  try {
    // Get all invoice headers (recent first)
    const raw = await qneGet<unknown>(
      `/SalesInvoices?$top=${maxInvoices}&$orderby=invoiceDate desc`,
      token,
    )
    const headers: RawInvoiceHeader[] = Array.isArray(raw)
      ? (raw as RawInvoiceHeader[])
      : ((raw as { value?: RawInvoiceHeader[] })?.value ?? [])

    // Filter out cancelled invoices
    const active = headers.filter(h => !h.isCancelled)

    // Build map of which invoice IDs/codes belong to which customer
    const byCustomer = new Map<string, string[]>()
    for (const h of active) {
      const code = h.customer?.trim()
      const invId = h.id?.trim() ?? h.invoiceCode?.trim()
      if (code && invId) {
        const list = byCustomer.get(code) ?? []
        list.push(invId)
        byCustomer.set(code, list)
      }
    }

    // Get companies in our CRM that have a QNE customer code
    const companies = await prisma.company.findMany({
      where:  { qneCustomerCode: { not: null } },
      select: { id: true, qneCustomerCode: true },
    })
    const companyMap = new Map(companies.map(c => [c.qneCustomerCode!, c.id]))

    // For each company that appears in the invoices, fetch details
    // Limit to top-N invoices per customer to bound total API calls
    const MAX_INVOICES_PER_CUSTOMER = 20
    const detailTasks: (() => Promise<{ companyId: string; detail: RawInvoiceDetail | null }>)[] = []

    for (const [code, invIds] of byCustomer) {
      const companyId = companyMap.get(code)
      if (!companyId) continue
      const limited = invIds.slice(0, MAX_INVOICES_PER_CUSTOMER)
      for (const invId of limited) {
        detailTasks.push(async () => {
          try {
            const detail = await qneGet<RawInvoiceDetail>(`/SalesInvoices/${invId}`, token)
            invoicesFetched++
            return { companyId, detail }
          } catch {
            return { companyId, detail: null }
          }
        })
      }
    }

    // Fetch with concurrency limit of 15 to avoid overwhelming QNE
    const results = await pLimit(detailTasks, 15)

    // Aggregate: companyId → itemName → { orderCount, totalQty, lastOrderAt }
    type ItemAgg = { orderCount: number; totalQty: number; lastOrderAt: Date; itemCode: string | null }
    const aggMap = new Map<string, Map<string, ItemAgg>>()

    for (const { companyId, detail } of results) {
      if (!detail) continue
      const items = extractItems(detail)
      const invoiceDate = detail.invoiceDate ? new Date(detail.invoiceDate) : new Date()

      for (const item of items) {
        const name = itemName(item)
        if (!name || name.length < 2) continue

        const qty   = itemQty(item)
        const code  = item.itemCode?.trim() ?? null

        let compAgg = aggMap.get(companyId)
        if (!compAgg) { compAgg = new Map(); aggMap.set(companyId, compAgg) }

        const existing = compAgg.get(name)
        if (existing) {
          existing.orderCount++
          existing.totalQty += qty
          if (invoiceDate > existing.lastOrderAt) existing.lastOrderAt = invoiceDate
          if (!existing.itemCode && code) existing.itemCode = code
        } else {
          compAgg.set(name, { orderCount: 1, totalQty: qty, lastOrderAt: invoiceDate, itemCode: code })
        }
      }
    }

    // Upsert into qne_top_items
    for (const [companyId, itemsAgg] of aggMap) {
      // Delete existing top items for this company first (full replace on sync)
      await prisma.qneTopItem.deleteMany({ where: { companyId } })

      // Keep top 15 items by orderCount for this company
      const sorted = [...itemsAgg.entries()]
        .sort((a, b) => b[1].orderCount - a[1].orderCount)
        .slice(0, 15)

      for (const [name, agg] of sorted) {
        await prisma.qneTopItem.create({
          data: {
            companyId,
            itemCode:   agg.itemCode,
            itemName:   name,
            orderCount: agg.orderCount,
            totalQty:   agg.totalQty,
            lastOrderAt: agg.lastOrderAt,
          },
        })
        itemsUpdated++
      }
    }
  } catch (err) {
    if (err instanceof QneUnavailableError) throw err
    errors.push(`Items sync error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { balancesUpdated, itemsUpdated, invoicesFetched, errors }
}
