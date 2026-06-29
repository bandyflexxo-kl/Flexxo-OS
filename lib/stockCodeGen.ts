/**
 * Standardised stock-code building (SOP-enforced).
 *
 * The code is NOT free-typed. House format: `[BRAND]-[SUPPLIER MODEL]`
 * (e.g. HP-CE320A, NISO-BP-838BL) — the brand prefix is the QNE classCode, the
 * model is the supplier's own model code (the one descriptive field the admin
 * enters). The system enforces the prefix, uppercases, strips spaces/symbols.
 *
 * The product NAME is then assembled in SOP order:
 *   Brand / Code / Description / Identity / Size / Colour / Packing
 *
 * Pure functions only (no DB) so both the form (client) and the API (server)
 * build identical codes.
 */

/** Uppercase, drop spaces, keep only letters/digits/dash (no symbols — SOP). */
export function sanitizeCodePart(s: string): string {
  return s.toUpperCase().trim().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '')
}

/** Builds `[BRAND]-[MODEL]` (e.g. HP-CE320A). Brand prefix is alphanumeric-only. */
export function buildStockCode(brand: string, supplierModel: string): string {
  const b = brand.toUpperCase().trim().replace(/[^A-Z0-9]/g, '')
  const m = sanitizeCodePart(supplierModel)
  return m ? `${b}-${m}` : b
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
