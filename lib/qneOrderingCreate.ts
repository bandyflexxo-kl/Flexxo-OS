/**
 * QNE ordering chain — QT → SO → DO → Invoice (Part B of the QNE write integration).
 *
 * Each CRM document is pushed to QNE as its own POST. Lines link to their source
 * line via `transferFrom`, which QNE uses to track fulfilment and prevent
 * double-invoicing. We persist the QNE-returned doc id + code + a per-line
 * detail-id map in `QneDocLink`; the next document reads the upstream lineMap to
 * populate its `transferFrom`.
 *
 *   quotation  → lineMap { quotationItemId: qneDetailId }
 *   salesOrder → transferFrom.quotationDetailId = QT lineMap[quotationItemId]
 *   deliveryOrder → transferFrom.salesOrderDetailId = SO lineMap[orderItemId]
 *   invoice    → transferFrom.deliveryOrderDetailId = DO lineMap[orderItemId]
 *
 * WRITE PATH — every caller must be behind a human-approval gate (CLAUDE.md).
 * Multi-branch: `branchCode` resolves to KL creds today; per-branch creds later.
 */

import { qneLogin, qneGet, qnePost } from '@/lib/qneClient'
import { prisma } from '@/lib/prisma'

const DEFAULT_BRANCH = 'KL'

export type DocType = 'quotation' | 'sales_order' | 'delivery_order' | 'invoice'

export type PushResult = {
  ok:      boolean
  docType: DocType
  qneId?:  string | null
  qneCode?: string | null
  error?:  string
}

type QneDetail = { id: string; stock?: string | null; pos?: number | null }
type QneDocResponse = {
  id?:            string
  quotationCode?: string
  orderCode?:     string
  doCode?:        string
  invoiceCode?:   string
  details?:       QneDetail[]
}

type LineMap = Record<string, string>

function resolveBranchToken(branchCode: string): Promise<string> {
  if (branchCode !== DEFAULT_BRANCH) {
    throw new Error(`Branch "${branchCode}" has no QNE credentials configured. Only KL is supported today.`)
  }
  return qneLogin()
}

/** Matches QNE-returned detail lines back to CRM item ids by 1-based pos (fallback: array order). */
function buildLineMap(crmItemIds: string[], details: QneDetail[] | undefined): LineMap {
  const byPos = new Map<number, string>()
  ;(details ?? []).forEach(d => { if (d.pos != null) byPos.set(d.pos, d.id) })
  const map: LineMap = {}
  crmItemIds.forEach((cid, i) => {
    const detId = byPos.get(i + 1) ?? details?.[i]?.id
    if (detId) map[cid] = detId
  })
  return map
}

function codeOf(resp: QneDocResponse): string | null {
  return resp.quotationCode ?? resp.orderCode ?? resp.doCode ?? resp.invoiceCode ?? null
}

async function getDocLink(docType: DocType, crmId: string) {
  return prisma.qneDocLink.findUnique({ where: { docType_crmId: { docType, crmId } } })
}

async function saveDocLink(args: {
  docType: DocType; crmId: string; branchCode: string
  qneId: string | null; qneCode: string | null; lineMap: LineMap; pushedById?: string | null
}) {
  const data = {
    branchCode: args.branchCode,
    qneId:      args.qneId,
    qneCode:    args.qneCode,
    status:     'synced',
    error:      null,
    lineMap:    args.lineMap as object,
    pushedAt:   new Date(),
    pushedById: args.pushedById ?? null,
  }
  return prisma.qneDocLink.upsert({
    where:  { docType_crmId: { docType: args.docType, crmId: args.crmId } },
    create: { docType: args.docType, crmId: args.crmId, ...data },
    update: data,
  })
}

async function markFailed(docType: DocType, crmId: string, branchCode: string, message: string) {
  await prisma.qneDocLink.upsert({
    where:  { docType_crmId: { docType, crmId } },
    create: { docType, crmId, branchCode, status: 'failed', error: message },
    update: { status: 'failed', error: message },
  })
}

// ── Quotation ────────────────────────────────────────────────────────────────
export async function qneQuotationCreate(
  quotationId: string,
  opts: { branchCode?: string; pushedById?: string } = {},
): Promise<PushResult> {
  const branchCode = opts.branchCode ?? DEFAULT_BRANCH
  const already = await getDocLink('quotation', quotationId)
  if (already?.status === 'synced')
    return { ok: true, docType: 'quotation', qneId: already.qneId, qneCode: already.qneCode }
  const q = await prisma.quotation.findUnique({
    where:   { id: quotationId },
    include: {
      company:   { select: { name: true, qneCustomerCode: true } },
      createdBy: { select: { name: true } },
      items:     { orderBy: { sortOrder: 'asc' }, include: { product: { select: { qneItemCode: true } } } },
    },
  })
  if (!q) return { ok: false, docType: 'quotation', error: 'Quotation not found' }
  if (!q.company.qneCustomerCode)
    return { ok: false, docType: 'quotation', error: `${q.company.name} has no QNE customer code — sync/create the customer in QNE first.` }

  const missing = q.items.filter(it => !it.product?.qneItemCode)
  if (missing.length)
    return { ok: false, docType: 'quotation', error: `${missing.length} line(s) have no QNE stock code — create those stock codes first.` }

  const payload = {
    quotationDate:  (q.sentAt ?? q.createdAt).toISOString(),
    customer:       q.company.qneCustomerCode,
    customerName:   q.company.name,
    // salesPerson omitted — QNE wants the agent CODE (e.g. SALES 1), not the CRM
    // user name. TODO: map CRM user → QNE agent code before re-enabling.
    referenceNo:    q.referenceNo,
    currencyRate:   1,
    isTaxInclusive: false,
    details: q.items.map((it, i) => ({
      stock:       it.product!.qneItemCode!,
      description: it.description,
      qty:         Number(it.qty),
      uom:         it.unit ?? '',
      unitPrice:   Number(it.unitPrice),
      pos:         i + 1,
    })),
  }

  try {
    const token = await resolveBranchToken(branchCode)
    const resp  = await qnePost<QneDocResponse>('/Quotations', token, payload)
    const link  = await saveDocLink({
      docType: 'quotation', crmId: quotationId, branchCode,
      qneId: resp.id ?? null, qneCode: codeOf(resp),
      lineMap: buildLineMap(q.items.map(it => it.id), resp.details),
      pushedById: opts.pushedById,
    })
    return { ok: true, docType: 'quotation', qneId: link.qneId, qneCode: link.qneCode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    await markFailed('quotation', quotationId, branchCode, message)
    return { ok: false, docType: 'quotation', error: message }
  }
}

// ── Shared: load an order with the relations every order-stage push needs ─────
async function loadOrderForPush(orderId: string) {
  return prisma.order.findUnique({
    where:   { id: orderId },
    include: {
      company: { select: { name: true, qneCustomerCode: true } },
      createdBy: { select: { name: true } },
      items:   { include: { product: { select: { qneItemCode: true } }, quotationItem: { select: { id: true } } } },
    },
  })
}

type OrderForPush = NonNullable<Awaited<ReturnType<typeof loadOrderForPush>>>

function orderLineDetails(order: OrderForPush, upstream: LineMap | null, upstreamKey: 'quotationItem' | 'orderItem') {
  return order.items.map((it, i) => {
    const key = upstreamKey === 'quotationItem' ? it.quotationItem?.id : it.id
    const transferId = key && upstream ? upstream[key] : undefined
    return {
      stock:       it.product?.qneItemCode ?? '',
      description: it.product?.qneItemCode ?? 'Item',
      qty:         Number(it.qty),
      unitPrice:   Number(it.unitPrice),
      pos:         i + 1,
      ...(transferId
        ? { transferFrom: upstreamKey === 'quotationItem'
            ? { quotationDetailId: transferId }
            : { salesOrderDetailId: transferId } }
        : {}),
    }
  })
}

// ── Sales Order (transfer from Quotation) ────────────────────────────────────
export async function qneSalesOrderCreate(
  orderId: string,
  opts: { branchCode?: string; pushedById?: string } = {},
): Promise<PushResult> {
  const branchCode = opts.branchCode ?? DEFAULT_BRANCH
  const already = await getDocLink('sales_order', orderId)
  if (already?.status === 'synced')
    return { ok: true, docType: 'sales_order', qneId: already.qneId, qneCode: already.qneCode }
  const order = await loadOrderForPush(orderId)
  if (!order) return { ok: false, docType: 'sales_order', error: 'Order not found' }
  if (!order.company.qneCustomerCode)
    return { ok: false, docType: 'sales_order', error: `${order.company.name} has no QNE customer code.` }

  // Upstream QT lineMap (optional — SO can be created fresh if the QT wasn't pushed)
  const qtLink = order.quotationId ? await getDocLink('quotation', order.quotationId) : null
  const qtLineMap = (qtLink?.lineMap as LineMap | null) ?? null

  const payload = {
    customer:       order.company.qneCustomerCode,
    customerName:   order.company.name,
    orderDate:      order.createdAt.toISOString(),
    // salesPerson omitted — QNE wants the agent CODE, not the CRM user name (see TODO above).
    referenceNo:    order.referenceNo ?? undefined,
    currencyRate:   1,
    isTaxInclusive: false,
    details:        orderLineDetails(order, qtLineMap, 'quotationItem'),
  }

  try {
    const token = await resolveBranchToken(branchCode)
    const resp  = await qnePost<QneDocResponse>('/SalesOrders', token, payload)
    const link  = await saveDocLink({
      docType: 'sales_order', crmId: orderId, branchCode,
      qneId: resp.id ?? null, qneCode: codeOf(resp),
      lineMap: buildLineMap(order.items.map(it => it.id), resp.details),
      pushedById: opts.pushedById,
    })
    return { ok: true, docType: 'sales_order', qneId: link.qneId, qneCode: link.qneCode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    await markFailed('sales_order', orderId, branchCode, message)
    return { ok: false, docType: 'sales_order', error: message }
  }
}

// ── Delivery Order (transfer from Sales Order) ───────────────────────────────
export async function qneDeliveryOrderCreate(
  orderId: string,
  opts: { branchCode?: string; pushedById?: string } = {},
): Promise<PushResult> {
  const branchCode = opts.branchCode ?? DEFAULT_BRANCH
  const already = await getDocLink('delivery_order', orderId)
  if (already?.status === 'synced')
    return { ok: true, docType: 'delivery_order', qneId: already.qneId, qneCode: already.qneCode }
  const order = await loadOrderForPush(orderId)
  if (!order) return { ok: false, docType: 'delivery_order', error: 'Order not found' }
  if (!order.company.qneCustomerCode)
    return { ok: false, docType: 'delivery_order', error: `${order.company.name} has no QNE customer code.` }

  const soLink = await getDocLink('sales_order', orderId)
  const soLineMap = (soLink?.lineMap as LineMap | null) ?? null

  const payload = {
    customer:       order.company.qneCustomerCode,
    customerName:   order.company.name,
    doDate:         new Date().toISOString(),
    // salesPerson omitted — QNE wants the agent CODE, not the CRM user name (see TODO above).
    referenceNo:    order.referenceNo ?? undefined,
    currencyRate:   1,
    isTaxInclusive: false,
    details:        orderLineDetails(order, soLineMap, 'orderItem'),
  }

  try {
    const token = await resolveBranchToken(branchCode)
    const resp  = await qnePost<QneDocResponse>('/DeliveryOrders', token, payload)
    const link  = await saveDocLink({
      docType: 'delivery_order', crmId: orderId, branchCode,
      qneId: resp.id ?? null, qneCode: codeOf(resp),
      lineMap: buildLineMap(order.items.map(it => it.id), resp.details),
      pushedById: opts.pushedById,
    })
    await prisma.order.update({ where: { id: orderId }, data: { qneDoRef: link.qneCode } })
    return { ok: true, docType: 'delivery_order', qneId: link.qneId, qneCode: link.qneCode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    await markFailed('delivery_order', orderId, branchCode, message)
    return { ok: false, docType: 'delivery_order', error: message }
  }
}

// ── Invoice (transfer from Delivery Order) ───────────────────────────────────
export async function qneInvoiceCreate(
  orderId: string,
  opts: { branchCode?: string; pushedById?: string } = {},
): Promise<PushResult> {
  const branchCode = opts.branchCode ?? DEFAULT_BRANCH
  const already = await getDocLink('invoice', orderId)
  if (already?.status === 'synced')
    return { ok: true, docType: 'invoice', qneId: already.qneId, qneCode: already.qneCode }
  const order = await loadOrderForPush(orderId)
  if (!order) return { ok: false, docType: 'invoice', error: 'Order not found' }
  if (!order.company.qneCustomerCode)
    return { ok: false, docType: 'invoice', error: `${order.company.name} has no QNE customer code.` }

  const doLink = await getDocLink('delivery_order', orderId)
  const doLineMap = (doLink?.lineMap as LineMap | null) ?? null

  const payload = {
    customer:       order.company.qneCustomerCode,
    customerName:   order.company.name,
    invoiceDate:    new Date().toISOString(),
    // salesPerson omitted — QNE wants the agent CODE, not the CRM user name (see TODO above).
    referenceNo:    order.referenceNo ?? undefined,
    currencyRate:   1,
    isTaxInclusive: false,
    details: order.items.map((it, i) => {
      const transferId = doLineMap?.[it.id]
      return {
        stock:       it.product?.qneItemCode ?? '',
        description: it.product?.qneItemCode ?? 'Item',
        qty:         Number(it.qty),
        unitPrice:   Number(it.unitPrice),
        pos:         i + 1,
        ...(transferId ? { transferFrom: { deliveryOrderDetailId: transferId } } : {}),
      }
    }),
  }

  try {
    const token = await resolveBranchToken(branchCode)
    const resp  = await qnePost<QneDocResponse>('/SalesInvoices', token, payload)
    const link  = await saveDocLink({
      docType: 'invoice', crmId: orderId, branchCode,
      qneId: resp.id ?? null, qneCode: codeOf(resp),
      lineMap: buildLineMap(order.items.map(it => it.id), resp.details),
      pushedById: opts.pushedById,
    })
    await prisma.order.update({ where: { id: orderId }, data: { qneInvoiceRef: link.qneCode } })
    return { ok: true, docType: 'invoice', qneId: link.qneId, qneCode: link.qneCode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    await markFailed('invoice', orderId, branchCode, message)
    return { ok: false, docType: 'invoice', error: message }
  }
}

// ── Shortcut: QuotationToInvoice (simple deals — skips SO/DO; B2C-friendly) ───
// QNE returns no body, so we follow up with a GET to retrieve the new invoice code.
export async function qneQuotationToInvoice(
  quotationId: string,
  opts: { branchCode?: string; pushedById?: string } = {},
): Promise<PushResult> {
  const branchCode = opts.branchCode ?? DEFAULT_BRANCH
  const qtLink = await getDocLink('quotation', quotationId)
  if (!qtLink?.qneId)
    return { ok: false, docType: 'invoice', error: 'Quotation has not been pushed to QNE yet.' }
  const alreadyInv = await getDocLink('invoice', quotationId)
  if (alreadyInv?.status === 'synced')
    return { ok: true, docType: 'invoice', qneId: alreadyInv.qneId, qneCode: alreadyInv.qneCode }

  const q = await prisma.quotation.findUnique({
    where: { id: quotationId }, select: { company: { select: { qneCustomerCode: true } } },
  })
  const customer = q?.company.qneCustomerCode

  try {
    const token = await resolveBranchToken(branchCode)
    await qnePost<unknown>(`/SalesTransfer/QuotationToInvoice?quotationId=${qtLink.qneId}`, token, {})

    // Retrieve the freshly-created invoice (shortcut returns no body)
    let qneId: string | null = null
    let qneCode: string | null = null
    if (customer) {
      const filter = `$filter=customer eq '${customer}'&$orderby=invoiceDate desc&$top=1`
      const rows = await qneGet<QneDocResponse[] | { value?: QneDocResponse[] }>(`/SalesInvoices?${filter}`, token)
        .catch(() => null)
      const inv = Array.isArray(rows) ? rows[0] : rows?.value?.[0]
      qneId   = inv?.id ?? null
      qneCode = inv ? codeOf(inv) : null
    }
    const link = await saveDocLink({
      docType: 'invoice', crmId: quotationId, branchCode, qneId, qneCode, lineMap: {}, pushedById: opts.pushedById,
    })
    return { ok: true, docType: 'invoice', qneId: link.qneId, qneCode: link.qneCode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QNE push failed'
    await markFailed('invoice', quotationId, branchCode, message)
    return { ok: false, docType: 'invoice', error: message }
  }
}
