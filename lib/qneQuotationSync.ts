/**
 * lib/qneQuotationSync.ts
 * Pulls QNE Quotations + line items → qne_quotations + qne_quotation_items.
 *
 * Mirrors the pattern from lib/qneInvoiceSync.ts.
 * QNE READ-ONLY — only GET calls.
 *
 * Field names are resolved defensively (QNE field naming is inconsistent):
 *   Header: id, quotationCode/docNo, quotationDate/docDate, customer/companyCode,
 *           totalAmount, status, expiryDate, salesperson/agentCode
 *   Items:  itemCode/stockCode, description/itemName, qty/quantity,
 *           unitPrice/unitSellPrice, amount/lineTotal
 *
 * Run via: npx tsx scripts/syncQneQuotations.ts
 * Requires: Radmin VPN connected to Flexxokl
 */

import { prisma }                                from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'
import { Prisma }                                from '@/generated/prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuotationSyncResult = {
  ok:                 boolean
  quotationsFetched:  number
  quotationsUpserted: number
  itemsUpserted:      number
  companiesLinked:    number
  errors:             string[]
}

type RawQuotationHeader = {
  id?:              string | null
  quotationCode?:   string | null
  docNo?:           string | null
  quotationDate?:   string | null
  docDate?:         string | null
  customer?:        string | null
  companyCode?:     string | null
  customerName?:    string | null
  totalAmount?:     number | null
  status?:          string | null
  expiryDate?:      string | null
  salesperson?:     string | null
  agentCode?:       string | null
  [key: string]:    unknown
}

type RawQuotationItem = {
  // QNE quotation detail line ("details" array) uses `stock` for the stock code,
  // `amount`/`netAmount` for line totals, `uom` for unit. Older defensive aliases kept.
  stock?:         string | null   // ← actual QNE stock-code field on a quotation line
  itemCode?:      string | null
  stockCode?:     string | null
  description?:   string | null
  desc2?:         string | null
  itemName?:      string | null
  uom?:           string | null
  qty?:           number | null
  quantity?:      number | null
  unitQty?:       number | null
  unitPrice?:     number | null
  unitSellPrice?: number | null
  amount?:        number | null
  netAmount?:     number | null
  lineTotal?:     number | null
  [key: string]:  unknown
}

type RawQuotationDetail = {
  quotationCode?: string | null
  docNo?:         string | null
  customer?:      string | null
  companyCode?:   string | null
  items?:         RawQuotationItem[] | null
  details?:       RawQuotationItem[] | null
  [key: string]:  unknown
}

// ── Quotation sync ────────────────────────────────────────────────────────────

const PAGE = 200

export async function syncQneQuotations(fromDate?: string): Promise<QuotationSyncResult> {
  const result: QuotationSyncResult = {
    ok: true, quotationsFetched: 0, quotationsUpserted: 0, itemsUpserted: 0,
    companiesLinked: 0, errors: [],
  }

  let token: string
  try {
    token = await qneLogin()
  } catch (e) {
    result.ok = false
    result.errors.push(`QNE login failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  // Build customer code → CRM company ID map
  const companies = await prisma.company.findMany({
    where:  { qneCustomerCode: { not: null } },
    select: { id: true, qneCustomerCode: true },
  })
  const companyByCode = new Map(companies.map(c => [c.qneCustomerCode!, c.id]))

  // Build stock code → product ID map for line item matching
  const products = await prisma.product.findMany({
    where:  { qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })
  const productByCode = new Map(products.map(p => [p.qneItemCode!, p.id]))

  // Fetch quotation headers (paginated)
  const headers: RawQuotationHeader[] = []
  let skip = 0
  while (true) {
    try {
      const url  = `/Quotations?$top=${PAGE}&$skip=${skip}`
      const data = await qneGet(url, token) as unknown
      const page: RawQuotationHeader[] = Array.isArray(data)
        ? (data as RawQuotationHeader[])
        : (((data as Record<string, unknown>).value ?? (data as Record<string, unknown>).data) as RawQuotationHeader[]) ?? []
      if (page.length === 0) break
      headers.push(...page)
      result.quotationsFetched += page.length
      if (page.length < PAGE) break
      skip += PAGE
    } catch (e) {
      if (e instanceof QneUnavailableError) {
        result.ok = false
        result.errors.push('QNE unavailable — is Radmin VPN connected?')
        return result
      }
      result.errors.push(`Fetch page skip=${skip}: ${e instanceof Error ? e.message : String(e)}`)
      break
    }
  }

  // Process each header
  for (const h of headers) {
    try {
      const docNo = h.quotationCode ?? h.docNo ?? null
      if (!docNo) continue

      const customerCode = h.customer ?? h.companyCode ?? ''
      const customerName = (h.customerName as string | null) ?? customerCode
      const docDate      = h.quotationDate ?? h.docDate
      const parsedDate   = docDate ? new Date(docDate) : new Date()
      const expiryDate   = h.expiryDate ? new Date(h.expiryDate) : null
      const totalAmount  = h.totalAmount ?? 0
      const status       = h.status ?? null
      const salesperson  = h.salesperson ?? h.agentCode ?? null
      const companyId    = companyByCode.get(customerCode) ?? null
      if (companyId) result.companiesLinked++

      // Upsert header
      const upserted = await prisma.qneQuotation.upsert({
        where:  { docNo },
        create: { docNo, docDate: parsedDate, expiryDate, customerCode, customerName, salesperson, totalAmount: new Prisma.Decimal(totalAmount), status, companyId, syncedAt: new Date() },
        update: { docDate: parsedDate, expiryDate, customerCode, customerName, salesperson, totalAmount: new Prisma.Decimal(totalAmount), status, companyId, syncedAt: new Date() },
      })
      result.quotationsUpserted++

      // Fetch detail for line items — key on the QNE internal id (GUID), NOT the
      // docNo. Quotation docNos look like "KL2606/0077"; the slash is not a valid
      // path segment (even URL-encoded, QNE's route doesn't match it) so the old
      // `/Quotations/{docNo}` form 404'd every time → the catch swallowed it →
      // zero line items ever synced. /Quotations/{id} mirrors /SalesInvoices/{id}.
      try {
        const quotationId = (h.id as string | null | undefined)?.trim() || docNo
        const detail = await qneGet(`/Quotations/${encodeURIComponent(quotationId)}`, token) as RawQuotationDetail
        const rawItems = detail.items ?? detail.details ?? []
        if (rawItems.length === 0) result.errors.push(`Items for ${docNo}: detail returned no items`)

        // Replace all items for this quotation
        await prisma.qneQuotationItem.deleteMany({ where: { quotationId: upserted.id } })

        for (const item of rawItems) {
          const stockCode   = item.stock ?? item.itemCode ?? item.stockCode ?? null
          const description = item.description ?? item.desc2 ?? item.itemName ?? stockCode ?? ''
          const qty         = item.qty ?? item.quantity ?? item.unitQty ?? 0
          const unitPrice   = item.unitPrice ?? item.unitSellPrice ?? 0
          const lineTotal   = item.netAmount ?? item.amount ?? item.lineTotal ?? (qty * unitPrice)
          const productId   = stockCode ? (productByCode.get(stockCode) ?? null) : null

          await prisma.qneQuotationItem.create({
            data: {
              quotationId: upserted.id,
              stockCode,
              description: String(description),
              qty:       new Prisma.Decimal(qty),
              unitPrice: new Prisma.Decimal(unitPrice),
              lineTotal: new Prisma.Decimal(lineTotal),
              productId,
            },
          })
          result.itemsUpserted++
        }
      } catch {
        // Detail fetch failure is non-fatal — header still synced
        result.errors.push(`Items for ${docNo}: detail fetch failed`)
      }
    } catch (e) {
      result.errors.push(`Quotation ${h.quotationCode ?? h.docNo}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}
