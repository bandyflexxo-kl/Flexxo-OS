/**
 * QNE Stock Code creation (Part A of the QNE write integration).
 *
 * Writes a new stock item to QNE via POST /api/Stocks. The `category`/`group`/`class`
 * fields carry QNE's OWN taxonomy codes (from lib/qneStockMasters) — NOT the shop's
 * category slugs. The shop sub-category lives separately on Product.categoryId.
 *
 * WRITE PATH — every caller must be behind a human-approval gate (CLAUDE.md).
 * Multi-branch: `branchCode` is accepted for forward-compat; only 'KL' resolves to
 * QNE creds today (current env). KK/Kuching read per-branch creds later.
 */

import { qneLogin, qnePost, qnePut } from '@/lib/qneClient'

/** CRM-facing input — already Zod-validated upstream. */
export type NewStockInput = {
  stockCode:      string
  stockName:      string   // assembled per SOP order (brand/code/desc/identity/size/color/packing)
  baseUOM:        string
  category:       string   // QNE categoryCode (StockCategories)
  group:          string   // QNE groupCode    (StockGroups)
  brand:          string   // QNE classCode    (StockClasses) → written to `class`
  listPrice:      number   // selling price (MUST)
  purchasePrice:  number   // standard purchase price (MUST)
  minPrice?:      number   // lowest allowed selling price
  barCode?:       string
  description?:   string
  outputTaxCode?: string   // default 'SR'
  remarks?:       string[] // spec lines → remark1..5
  extraUoms?:     NewUomRow[]
}

/** Additional selling/buying unit beyond the base UOM (A5). */
export type NewUomRow = {
  uomCode:       string
  rate:          number    // base units per this UOM (1 CTN = 60 PCS → 60)
  barCode?:      string
  description?:  string
  salesPrice?:   number
  purchasePrice?: number
}

type QneUomRow = {
  uomCode:        string
  description?:   string
  salesPrice?:    number
  rate?:          number
  isBaseUOM?:     boolean
  purchasePrice?: number
  barCode?:       string
  pos?:           number
  isActive?:      boolean
}

/** Subset of QNE's StockDto we read back after creation. */
export type QneStockResponse = {
  id:        string
  stockCode: string
  stockName: string
  baseUOM:   string
  uoMs:      QneUomRow[]
}

function resolveBranchToken(branchCode: string): Promise<string> {
  if (branchCode !== 'KL') {
    throw new Error(`Branch "${branchCode}" has no QNE credentials configured. Only KL is supported today.`)
  }
  return qneLogin()
}

/** Builds the NewStock payload from CRM input. `autoCode: 0` = use our manual stockCode. */
export function buildNewStockPayload(input: NewStockInput): Record<string, unknown> {
  const remarks = input.remarks ?? []
  return {
    autoCode:             0,
    stockCode:            input.stockCode,
    stockName:            input.stockName,
    baseUOM:              input.baseUOM,
    category:             input.category,
    group:                input.group,
    class:                input.brand,
    listPrice:            input.listPrice,
    purchasePrice:        input.purchasePrice,
    ...(input.minPrice    !== undefined ? { minPrice: input.minPrice } : {}),
    ...(input.barCode     ? { barCode: input.barCode } : {}),
    ...(input.description ? { description: input.description } : {}),
    defaultOutputTaxCode: input.outputTaxCode ?? 'SR',
    stockControl:         true,
    remark1:              remarks[0] ?? '',
    remark2:              remarks[1] ?? '',
    remark3:              remarks[2] ?? '',
    remark4:              remarks[3] ?? '',
    remark5:              remarks[4] ?? '',
  }
}

/**
 * Creates the stock item in QNE (base UOM only). If `extraUoms` are supplied, a
 * follow-up PUT appends them to StockDto.uoMs[]. Returns the QNE stock object
 * (id + stockCode are stored back on the CRM product).
 */
export async function createQneStockCode(branchCode: string, input: NewStockInput): Promise<QneStockResponse> {
  const token   = await resolveBranchToken(branchCode)
  const payload = buildNewStockPayload(input)
  const created = await qnePost<QneStockResponse>('/Stocks', token, payload)

  if (input.extraUoms && input.extraUoms.length > 0) {
    const merged: QneUomRow[] = [
      ...(created.uoMs ?? []),
      ...input.extraUoms.map((u, i) => ({
        uomCode:       u.uomCode,
        rate:          u.rate,
        description:   u.description ?? u.uomCode,
        salesPrice:    u.salesPrice ?? 0,
        purchasePrice: u.purchasePrice ?? 0,
        barCode:       u.barCode ?? '',
        isBaseUOM:     false,
        isActive:      true,
        pos:           (created.uoMs?.length ?? 0) + i + 1,
      })),
    ]
    const updated = await qnePut<QneStockResponse>('/Stocks', token, { ...created, uoMs: merged })
    return updated ?? created
  }

  return created
}
