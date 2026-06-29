/**
 * Standardised stock-code generation (SOP-enforced).
 *
 * Users no longer type stock codes manually. The system generates a short,
 * unique, brand-led code in the SOP's house format: `[BRAND]-[####]` per brand
 * (e.g. APLUS-0001, 3M-0001). The brand prefix is the QNE classCode. The running
 * number is the next free sequence for that brand among CRM-created codes.
 *
 * The product NAME is then assembled in SOP order:
 *   Brand / Code / Description / Identity / Size / Colour / Packing
 */

import { prisma } from '@/lib/prisma'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Next `[BRAND]-####` code for a brand, based on existing CRM-generated codes. */
export async function nextStockCode(brandCode: string): Promise<string> {
  const prefix = brandCode.trim().toUpperCase()
  if (!prefix) throw new Error('Brand is required to generate a stock code')

  const rows = await prisma.product.findMany({
    where:  { qneItemCode: { startsWith: `${prefix}-` } },
    select: { qneItemCode: true },
  })

  const re = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`, 'i')
  let max = 0
  for (const r of rows) {
    const m = r.qneItemCode?.match(re)
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

export type NameParts = {
  brand:        string
  code:         string
  description:  string
  identity?:    string
  size?:        string
  color?:       string
  packing?:     string
}

/** Assembles the SOP-ordered product name from its parts. */
export function assembleStockName(p: NameParts): string {
  return [p.brand, p.code, p.description, p.identity, p.size, p.color, p.packing]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(' / ')
}
