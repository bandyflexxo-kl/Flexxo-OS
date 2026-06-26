/**
 * lib/qneDeliveryOrderSync.ts
 * Pulls QNE Delivery Orders + line items → qne_delivery_orders + qne_delivery_order_items.
 * Mirrors the pattern from lib/qneQuotationSync.ts.
 * QNE READ-ONLY — only GET calls.
 */

import { prisma }                                from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'
import { Prisma }                                from '@/generated/prisma/client'

export type DeliveryOrderSyncResult = {
  ok:                 boolean
  docsFetched:        number
  docsUpserted:       number
  itemsUpserted:      number
  companiesLinked:    number
  errors:             string[]
}

type RawDOHeader = {
  id?:                   string | null
  deliveryOrderCode?:    string | null
  doCode?:               string | null
  docNo?:                string | null
  deliveryOrderDate?:    string | null
  deliveryDate?:         string | null
  docDate?:              string | null
  customer?:             string | null
  companyCode?:          string | null
  customerCode?:         string | null
  customerName?:         string | null
  totalAmount?:          number | null
  status?:               string | null
  [key: string]:         unknown
}

type RawDOItem = {
  itemCode?:       string | null
  stockCode?:      string | null
  description?:    string | null
  itemName?:       string | null
  qty?:            number | null
  quantity?:       number | null
  unitQty?:        number | null
  unitPrice?:      number | null
  unitSellPrice?:  number | null
  amount?:         number | null
  lineTotal?:      number | null
  [key: string]:   unknown
}

function resolveDocNo(h: RawDOHeader): string | null {
  return (h.deliveryOrderCode ?? h.doCode ?? h.docNo ?? h.id ?? null) as string | null
}
function resolveDate(h: RawDOHeader): string | null {
  return (h.deliveryOrderDate ?? h.deliveryDate ?? h.docDate ?? null) as string | null
}
function resolveCustomerCode(h: RawDOHeader): string | null {
  return (h.customer ?? h.companyCode ?? h.customerCode ?? null) as string | null
}
function resolveCustomerName(h: RawDOHeader): string {
  return ((h.customerName as string | null | undefined) ?? '')
}
function resolveItemCode(i: RawDOItem): string | null {
  return (i.itemCode ?? i.stockCode ?? null) as string | null
}
function resolveDescription(i: RawDOItem): string {
  return ((i.description ?? i.itemName ?? '') as string)
}
function resolveQty(i: RawDOItem): number {
  return Number(i.qty ?? i.quantity ?? i.unitQty ?? 0)
}
function resolveUnitPrice(i: RawDOItem): number {
  return Number(i.unitPrice ?? i.unitSellPrice ?? 0)
}
function resolveLineTotal(i: RawDOItem): number {
  return Number(i.amount ?? i.lineTotal ?? 0)
}

export async function syncQneDeliveryOrders(fromDate?: string): Promise<DeliveryOrderSyncResult> {
  const errors: string[] = []
  const token  = await qneLogin()

  const companies = await prisma.company.findMany({
    where:  { qneCustomerCode: { not: null } },
    select: { id: true, qneCustomerCode: true },
  })
  const companyByCode = new Map(companies.map(c => [c.qneCustomerCode!.trim().toUpperCase(), c.id]))

  const headers: RawDOHeader[] = []
  let skip = 0
  const top = 100

  while (true) {
    try {
      const url = `/DeliveryOrders?$top=${top}&$skip=${skip}`
      const raw  = await qneGet<unknown>(url, token)
      const page = (
        Array.isArray(raw)                                       ? raw
        : Array.isArray((raw as Record<string, unknown>).value)  ? (raw as Record<string, unknown>).value
        : Array.isArray((raw as Record<string, unknown>).data)   ? (raw as Record<string, unknown>).data
        : []
      ) as RawDOHeader[]

      if (page.length === 0) break
      headers.push(...page)
      if (page.length < top) break
      skip += top
    } catch (err) {
      if (err instanceof QneUnavailableError) throw err
      errors.push(`DeliveryOrders page (skip=${skip}): ${err instanceof Error ? err.message : String(err)}`)
      break
    }
  }

  let docsUpserted    = 0
  let itemsUpserted   = 0
  let companiesLinked = 0

  for (const header of headers) {
    const docNo        = resolveDocNo(header)
    const dateStr      = resolveDate(header)
    const customerCode = resolveCustomerCode(header)
    const customerName = resolveCustomerName(header)

    if (!docNo || !dateStr) { errors.push(`Skipped DO: missing docNo or date`); continue }

    const docDate = new Date(dateStr)
    if (isNaN(docDate.getTime())) { errors.push(`Skipped ${docNo}: invalid date ${dateStr}`); continue }

    const companyId = customerCode
      ? (companyByCode.get(customerCode.trim().toUpperCase()) ?? null)
      : null
    if (companyId) companiesLinked++

    try {
      const doRecord = await prisma.qneDeliveryOrder.upsert({
        where:  { docNo },
        create: {
          docNo,
          docDate,
          customerCode: customerCode ?? '',
          customerName,
          companyId,
          totalAmount:  new Prisma.Decimal(header.totalAmount ?? 0),
          status:       (header.status as string | null | undefined) ?? null,
          syncedAt:     new Date(),
        },
        update: {
          docDate,
          customerCode: customerCode ?? '',
          customerName,
          companyId,
          totalAmount:  new Prisma.Decimal(header.totalAmount ?? 0),
          status:       (header.status as string | null | undefined) ?? null,
          syncedAt:     new Date(),
        },
        select: { id: true },
      })
      docsUpserted++

      const itemsRaw = header.items ?? header.lineItems ?? header.details ?? null
      let rawItems: RawDOItem[] = []

      if (Array.isArray(itemsRaw)) {
        rawItems = itemsRaw as RawDOItem[]
      } else {
        try {
          const detail = await qneGet<Record<string, unknown>>(`/DeliveryOrders/${docNo}`, token)
          const detailItems = detail.items ?? detail.lineItems ?? detail.details ?? []
          if (Array.isArray(detailItems)) rawItems = detailItems as RawDOItem[]
        } catch { /* no items endpoint — skip */ }
      }

      if (rawItems.length > 0) {
        await prisma.qneDeliveryOrderItem.deleteMany({ where: { deliveryOrderId: doRecord.id } })
        for (const item of rawItems) {
          const stockCode   = resolveItemCode(item)
          const description = resolveDescription(item)
          if (!description && !stockCode) continue

          const product = stockCode
            ? await prisma.product.findFirst({ where: { qneItemCode: { equals: stockCode, mode: 'insensitive' } }, select: { id: true } })
            : null

          await prisma.qneDeliveryOrderItem.create({
            data: {
              deliveryOrderId: doRecord.id,
              stockCode:       stockCode ?? null,
              description:     description || stockCode || '—',
              qty:             new Prisma.Decimal(resolveQty(item)),
              unitPrice:       new Prisma.Decimal(resolveUnitPrice(item)),
              lineTotal:       new Prisma.Decimal(resolveLineTotal(item)),
              productId:       product?.id ?? null,
            },
          })
          itemsUpserted++
        }
      }
    } catch (err) {
      errors.push(`DO ${docNo}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { ok: true, docsFetched: headers.length, docsUpserted, itemsUpserted, companiesLinked, errors }
}
