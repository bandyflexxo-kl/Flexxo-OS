/**
 * lib/qneInvoiceSync.ts
 * Syncs QNE SalesInvoices + line items → qne_invoices + qne_invoice_items.
 * Also syncs customer balances (+ creditLimit) → companies.
 *
 * Run via: npx tsx scripts/syncQneInvoices.ts
 * Requires: Radmin VPN connected to Flexxokl
 * QNE READ-ONLY — only GET calls.
 *
 * Field names discovered from lib/qnePortfolio.ts (confirmed working):
 *   Invoice header: id, invoiceCode, invoiceDate, customer (=companyCode), totalAmount, isCancelled
 *   Invoice detail: items[] → itemCode, description/itemName, qty/quantity/unitQty, unitPrice/unitSellPrice, amount/lineTotal
 *   Customer:       companyCode, currentBalance, creditLimit
 */

import { prisma }                                from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'
import { Prisma }                                from '@/generated/prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvoiceSyncResult = {
  ok:              boolean
  invoicesFetched: number
  invoicesUpserted: number
  itemsUpserted:   number
  companiesLinked: number
  errors:          string[]
}

export type AgingSyncResult = {
  ok:               boolean
  recordsFetched:   number
  companiesUpdated: number
  errors:           string[]
}

type RawCustomer = {
  id?:             string
  companyCode?:    string
  currentBalance?: number | null
  creditLimit?:    number | null
  [key: string]:   unknown
}

type RawInvoiceHeader = {
  id?:           string | null
  invoiceCode?:  string | null
  invoiceDate?:  string | null
  customer?:     string | null   // = companyCode
  totalAmount?:  number | null
  isCancelled?:  boolean
  [key: string]: unknown
}

type RawInvoiceItem = {
  itemCode?:        string | null
  description?:     string | null
  itemName?:        string | null
  qty?:             number | null
  quantity?:        number | null
  unitQty?:         number | null
  unitPrice?:       number | null
  unitSellPrice?:   number | null
  amount?:          number | null
  lineTotal?:       number | null
  [key: string]:    unknown
}

type RawInvoiceDetail = {
  invoiceCode?: string | null
  customer?:    string | null
  items?:       RawInvoiceItem[] | null
  details?:     RawInvoiceItem[] | null
  [key: string]: unknown
}

// ── Invoice sync ──────────────────────────────────────────────────────────────

const PAGE = 200   // OData $top per request

export async function syncQneInvoices(
  fromDate?: string   // ISO date e.g. "2023-01-01" — defaults to 2 years ago
): Promise<InvoiceSyncResult> {
  const result: InvoiceSyncResult = {
    ok: false, invoicesFetched: 0, invoicesUpserted: 0, itemsUpserted: 0, companiesLinked: 0, errors: [],
  }

  let token: string
  try {
    token = await qneLogin()
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      result.errors.push('QNE unreachable — is Radmin VPN connected?')
    } else {
      result.errors.push(`QNE login failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return result
  }

  const cutoff = fromDate ?? (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 2)
    return d.toISOString().slice(0, 10)
  })()

  // Build lookup maps
  const companies = await prisma.company.findMany({
    where:  { qneCustomerCode: { not: null } },
    select: { id: true, qneCustomerCode: true },
  })
  const codeToCompanyId = new Map(companies.map(c => [c.qneCustomerCode!, c.id]))

  const products = await prisma.product.findMany({
    where:  { qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })
  const itemCodeToProductId = new Map(products.map(p => [p.qneItemCode!, p.id]))

  // Paginate invoice headers with OData $top / $skip
  let skip = 0
  let hasMore = true

  while (hasMore) {
    let headers: RawInvoiceHeader[] = []
    try {
      const raw = await qneGet<unknown>(
        `/SalesInvoices?$top=${PAGE}&$skip=${skip}&$orderby=invoiceDate desc`,
        token,
      )
      const arr = Array.isArray(raw) ? raw as RawInvoiceHeader[]
               : (raw as { value?: RawInvoiceHeader[] })?.value ?? []
      headers = arr
    } catch (err) {
      result.errors.push(`Fetch error at skip=${skip}: ${err instanceof Error ? err.message : String(err)}`)
      break
    }

    if (headers.length === 0) { hasMore = false; break }

    if (skip === 0 && headers.length > 0) {
      console.log('[invoice-sync] First header fields:', Object.keys(headers[0]).join(', '))
    }

    const active = headers.filter(h => !h.isCancelled)

    for (const h of active) {
      const docNo = h.invoiceCode?.trim() ?? h.id?.trim()
      if (!docNo) continue

      const invoiceDate = h.invoiceDate ? new Date(h.invoiceDate) : new Date()

      // Skip invoices before cutoff
      if (invoiceDate < new Date(cutoff)) continue

      const customerCode = h.customer?.trim() ?? ''
      const customerName = (h as Record<string, unknown>)['customerName'] as string | undefined
                        ?? customerCode
      const totalAmount  = h.totalAmount ?? 0
      const companyId    = codeToCompanyId.get(customerCode) ?? null

      // Fetch detail for line items
      let detail: RawInvoiceDetail | null = null
      try {
        const invId = h.id?.trim() ?? docNo
        detail = await qneGet<RawInvoiceDetail>(`/SalesInvoices/${invId}`, token)
      } catch {
        // no detail available — upsert header only
      }

      const rawItems: RawInvoiceItem[] = detail?.items ?? detail?.details ?? []

      // Upsert invoice header
      const invoice = await prisma.qneInvoice.upsert({
        where:  { docNo },
        create: {
          docNo,
          docDate:      invoiceDate,
          customerCode,
          customerName,
          companyId,
          totalAmount:  new Prisma.Decimal(totalAmount.toFixed(4)),
          status:       'posted',
        },
        update: {
          docDate:      invoiceDate,
          customerName,
          companyId,
          totalAmount:  new Prisma.Decimal(totalAmount.toFixed(4)),
          syncedAt:     new Date(),
        },
      })
      result.invoicesUpserted++
      if (companyId) result.companiesLinked++

      // Replace line items
      if (rawItems.length > 0) {
        await prisma.qneInvoiceItem.deleteMany({ where: { invoiceId: invoice.id } })

        for (const item of rawItems) {
          const stockCode  = item.itemCode?.trim() ?? null
          const description = item.description ?? item.itemName ?? stockCode ?? 'Unknown'
          const qty        = item.qty ?? item.quantity ?? item.unitQty ?? 0
          const unitPrice  = item.unitPrice ?? item.unitSellPrice ?? 0
          const lineTotal  = item.amount ?? item.lineTotal ?? (qty * unitPrice)
          const productId  = stockCode ? (itemCodeToProductId.get(stockCode) ?? null) : null

          await prisma.qneInvoiceItem.create({
            data: {
              invoiceId:   invoice.id,
              stockCode,
              description,
              qty:         new Prisma.Decimal(qty.toFixed(4)),
              unitPrice:   new Prisma.Decimal(unitPrice.toFixed(4)),
              lineTotal:   new Prisma.Decimal(lineTotal.toFixed(4)),
              productId,
            },
          })
          result.itemsUpserted++
        }
      }

      result.invoicesFetched++
    }

    skip += PAGE
    hasMore = headers.length === PAGE

    // Brief pause so we don't overwhelm QNE
    await new Promise(r => setTimeout(r, 100))
  }

  result.ok = result.errors.length === 0
  return result
}

// ── Aging / balance sync ──────────────────────────────────────────────────────
// Uses GET /Customers (same as qnePortfolio.ts) — reads currentBalance + creditLimit.
// /Customers/AgingSummary returns 404 on this QNE build.

export async function syncQneAging(): Promise<AgingSyncResult> {
  const result: AgingSyncResult = {
    ok: false, recordsFetched: 0, companiesUpdated: 0, errors: [],
  }

  let token: string
  try {
    token = await qneLogin()
  } catch (err) {
    result.errors.push(`QNE login failed: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  let customers: RawCustomer[] = []
  try {
    const raw = await qneGet<unknown>('/Customers', token)
    customers = Array.isArray(raw) ? raw as RawCustomer[]
              : (raw as { value?: RawCustomer[] })?.value ?? []
  } catch (err) {
    result.errors.push(`Customers fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  if (customers.length > 0) {
    console.log('[aging-sync] First customer fields:', Object.keys(customers[0]).join(', '))
  }

  result.recordsFetched = customers.length
  const now = new Date()

  for (const c of customers) {
    const code = c.companyCode?.trim()
    if (!code) continue

    const outstanding = Number(c.currentBalance ?? 0)
    const credit      = Number(c.creditLimit ?? 0)

    const updated = await prisma.company.updateMany({
      where: { qneCustomerCode: code },
      data: {
        outstandingBalance:   new Prisma.Decimal(outstanding.toFixed(4)),
        creditLimit:          new Prisma.Decimal(credit.toFixed(4)),
        outstandingUpdatedAt: now,
      },
    })
    if (updated.count > 0) result.companiesUpdated++
  }

  result.ok = result.errors.length === 0
  return result
}
