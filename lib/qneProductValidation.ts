/**
 * Validation + duplicate gate for new stock codes (Part A, SOP §A6/A7).
 *
 * Encodes the SOP "DON'Ts": no special symbols in the code, no "test" names,
 * mandatory brand/category/group/UOM/prices, exactly one category, min ≤ sell.
 * Duplicate check runs against BOTH QNE (Stocks/Find) and the CRM products table
 * before any create — never auto-merge, a human confirms it is genuinely new.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { qneLogin, qneGet } from '@/lib/qneClient'
import { similarity } from '@/lib/similarity'

const NO_TEST = (v: string): boolean => !/\btest(ing)?\b/i.test(v)

const uomRowSchema = z.object({
  uomCode:       z.string().trim().min(1).max(20),
  rate:          z.number().positive('Conversion rate must be greater than 0'),
  barCode:       z.string().trim().max(50).optional(),
  description:   z.string().trim().max(120).optional(),
  salesPrice:    z.number().nonnegative().optional(),
  purchasePrice: z.number().nonnegative().optional(),
})

export const newStockSchema = z
  .object({
    // Stock code = [BRAND]-[supplierModel], assembled server-side (lib/stockCodeGen).
    // The admin types the supplier model; the system enforces the brand prefix +
    // assembles the SOP-order name. No free-form code entry.
    supplierModel: z
      .string()
      .trim()
      .min(1, 'Supplier model code is required')
      .max(30, 'Supplier model is too long')
      .refine(NO_TEST, 'Supplier model must not contain "test"'),
    nameDescription: z
      .string()
      .trim()
      .min(2, 'Description (search keyword) is required')
      .max(120, 'Description is too long')
      .refine(NO_TEST, 'Name must not contain "test" / "testing"'),
    nameIdentity: z.string().trim().max(60).optional(),
    nameSize:     z.string().trim().max(60).optional(),
    nameColor:    z.string().trim().max(40).optional(),
    namePacking:  z.string().trim().max(60).optional(),
    baseUOM:        z.string().trim().min(1, 'Base UOM is required').max(20),
    category:       z.string().trim().min(1, 'QNE category is required'),  // QNE categoryCode
    group:          z.string().trim().min(1, 'QNE group is required'),     // QNE groupCode
    brand:          z.string().trim().min(1, 'Brand is required'),         // QNE classCode → `class`
    shopCategoryId: z.string().uuid('Pick a shop sub-category for website display'),
    listPrice:      z.number().positive('Selling price must be greater than 0'),
    purchasePrice:  z.number().positive('Purchase price must be greater than 0'),
    minPrice:       z.number().nonnegative().optional(),
    barcode:        z.string().trim().max(50).optional(),
    description:    z.string().trim().max(500).optional(),
    outputTaxCode:  z.string().trim().max(20).optional(),
    remarks:        z.array(z.string().trim().max(200)).max(5).optional(),
    extraUoms:      z.array(uomRowSchema).max(10).optional(),
  })
  .refine(v => v.minPrice === undefined || v.minPrice <= v.listPrice, {
    message: 'Minimum price cannot exceed the selling price',
    path:    ['minPrice'],
  })

export type NewStockFormInput = z.infer<typeof newStockSchema>

export type DuplicateReport = {
  codeInQne: boolean
  codeInCrm: boolean
  similarNames: { name: string; qneItemCode: string | null; score: number }[]
}

type QneFindRow = { stockCode?: string; stockName?: string }

/** Pull the two longest alphabetic tokens — used to pre-filter CRM candidates. */
function keyTokens(name: string): string[] {
  return [...new Set(name.toLowerCase().match(/[a-z]{3,}/g) ?? [])]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
}

/**
 * Checks a candidate code + name against QNE and the CRM catalogue.
 * Read-only — safe to run before the human confirms creation.
 */
export async function checkStockDuplicates(
  stockCode: string,
  stockName: string,
  token?: string,
): Promise<DuplicateReport> {
  const tk = token ?? (await qneLogin())

  // Stocks/Find returns a SINGLE stock object on an exact match, or HTTP 404
  // (→ qneGet throws → caught as null) when nothing matches. Normalise to array.
  const found = stockCode
    ? await qneGet<QneFindRow | QneFindRow[] | null>(
        `/Stocks/Find?code=${encodeURIComponent(stockCode)}`,
        tk,
      ).catch(() => null)
    : null
  const qneMatches: QneFindRow[] = Array.isArray(found) ? found : found ? [found] : []

  const codeInQne = qneMatches.some(
    m => (m.stockCode ?? '').toLowerCase() === stockCode.toLowerCase(),
  )

  const crmByCode = await prisma.product.findFirst({
    where:  { OR: [{ qneItemCode: stockCode }, { internalSku: stockCode }] },
    select: { id: true },
  })

  // Fuzzy name pre-filter: candidates whose name contains a key token, then rank.
  const tokens = keyTokens(stockName)
  const candidates = tokens.length
    ? await prisma.product.findMany({
        where:   { OR: tokens.map(t => ({ name: { contains: t, mode: 'insensitive' as const } })) },
        select:  { name: true, qneItemCode: true },
        take:    50,
      })
    : []

  const lcName = stockName.toLowerCase()
  const similarNames = candidates
    .map(c => ({ name: c.name, qneItemCode: c.qneItemCode, score: similarity(lcName, c.name.toLowerCase()) }))
    .filter(c => c.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return { codeInQne, codeInCrm: !!crmByCode, similarNames }
}
