import 'server-only'
import { qneLogin, qnePost } from '@/lib/qneClient'

/**
 * Create a QNE Project representing a tender (one tender = one project).
 * The project code becomes the join key on every downstream PO/GRN/SO so QNE's
 * own reporting rolls the whole tender up. Uses the tender ref as projectCode.
 *
 * Gated by caller (tender.qne_writes_enabled) and rule #13 (double approval).
 * Returns the QNE project code on success; throws on failure (caller decides
 * whether to treat as fatal).
 */
export async function createQneTenderProject(t: {
  refNo: string
  name: string
  estValue: number | null
  periodStart: Date | null
  periodEnd: Date | null
}): Promise<string> {
  const token = await qneLogin()
  const body = {
    projectCode:      t.refNo,
    description:      t.name,
    contractSum:      t.estValue ?? 0,
    startDate:        (t.periodStart ?? new Date()).toISOString(),
    projectedEndDate: t.periodEnd ? t.periodEnd.toISOString() : undefined,
    isActive:         true,
  }
  await qnePost('/Projects', token, body)
  return t.refNo
}

/**
 * Create a QNE Purchase Order for a tender supplier PO. `purchaser` is left
 * BLANK deliberately (matches Flexxo's 2,631-PO precedent). Requires a QNE
 * supplier company code and per-line QNE stock codes. Returns QNE PO code.
 * Gated by caller (tender.qne_writes_enabled) + double approval (rule #13).
 */
export async function createQnePurchaseOrder(args: {
  supplierCode: string
  supplierName: string
  referenceNo:  string
  project?:     string | null
  requireDate?: Date | null
  items: { stock: string; qty: number; unitPrice: number; uom?: string | null; description?: string | null }[]
}): Promise<string> {
  if (!args.supplierCode) throw new Error('No QNE supplier code mapped for this supplier')
  if (args.items.some(i => !i.stock)) throw new Error('One or more items have no QNE stock code')

  const token = await qneLogin()
  const body = {
    supplier:          args.supplierCode,
    supplierName:      args.supplierName,
    purchaseOrderDate: new Date().toISOString(),
    referenceNo:       args.referenceNo,
    project:           args.project ?? undefined,
    requireDate:       args.requireDate ? args.requireDate.toISOString() : undefined,
    details: args.items.map((it, i) => ({
      numbering:   String(i + 1),
      stock:       it.stock,
      qty:         it.qty,
      unitPrice:   it.unitPrice,
      uom:         it.uom ?? undefined,
      description: it.description ?? undefined,
      project:     args.project ?? undefined,
    })),
  }
  const res = await qnePost<{ purchaseOrderCode?: string } | null>('/PurchaseOrders', token, body)
  return res?.purchaseOrderCode ?? args.referenceNo
}

/**
 * Create a QNE GRN (goods received note) for a tender delivery. References the
 * supplier PO via `referenceNo`. `purchase` (purchaser person) left blank.
 * Gated + double-approved like all QNE writes. Returns the QNE GRN code.
 */
export async function createQneGrn(args: {
  supplierCode: string
  supplierName: string
  referenceNo:  string   // tenderRef / poNumber
  project?:     string | null
  items: { stock: string; qty: number; unitPrice: number; uom?: string | null; note?: string | null }[]
}): Promise<string> {
  if (!args.supplierCode) throw new Error('No QNE supplier code mapped for this supplier')
  if (args.items.some(i => !i.stock)) throw new Error('One or more items have no QNE stock code')

  const token = await qneLogin()
  const body = {
    supplier:              args.supplierCode,
    supplierName:          args.supplierName,
    goodsReceivedNoteDate: new Date().toISOString(),
    referenceNo:           args.referenceNo,
    project:               args.project ?? undefined,
    details: args.items.map((it, i) => ({
      numbering: String(i + 1),
      stock:     it.stock,
      qty:       it.qty,
      unitPrice: it.unitPrice,
      amount:    it.qty * it.unitPrice,
      uom:       it.uom ?? undefined,
      note:      it.note ?? undefined,
    })),
  }
  const res = await qnePost<{ goodsReceivedNoteCode?: string } | null>('/GRNs', token, body)
  return res?.goodsReceivedNoteCode ?? args.referenceNo
}
