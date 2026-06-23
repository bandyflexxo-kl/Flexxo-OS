/**
 * lib/smartOrder.ts
 * Smart Order — parse a pasted item list + fuzzy-match each line to the
 * product catalogue.  Used by /api/smart-order/* routes.
 *
 * No AI required for text input; AI (Claude Vision) is used only in the
 * scan-image route to extract text from a photo before calling parseItemList.
 */

import { prisma }   from '@/lib/prisma'
import { Prisma }   from '@/app/generated/prisma/client'
import { getRedis } from '@/lib/redis'

// Inline price helpers — avoids importing lib/pricing which has 'server-only'
function _calcSellingPrice(
  costPrice:      Prisma.Decimal,
  productMargin:  Prisma.Decimal | null,
  categoryMargin: Prisma.Decimal | null,
  globalMarginPct: string,
): Prisma.Decimal {
  const margin = productMargin ?? categoryMargin ?? new Prisma.Decimal(globalMarginPct)
  return costPrice.times(new Prisma.Decimal(1).plus(margin.dividedBy(100))).toDecimalPlaces(2)
}

// ── Public types ─────────────────────────────────────────────────────────────

export type ParsedLine = {
  rawText:    string
  parsedName: string
  qty:        number
  unit:       string | null
}

export type ProductMatch = {
  id:                     string
  name:                   string
  brand:                  string | null
  unit:                   string | null
  qneItemCode:            string | null
  categoryName:           string
  sellingPrice:           string | null
  currency:               string
  supplierPriceVersionId: string | null
  score:                  number
  isVisible:              boolean   // true = stocked (isVisibleToCustomers)
  orderFreq:              number    // # of confirmed QNE Sales Invoices containing this item
  availableQty:           number | null  // QNE stock; null = not yet synced
}

export type MatchedLine = ParsedLine & {
  confidence:   'high' | 'medium' | 'none'
  topMatch:     ProductMatch | null
  alternatives: ProductMatch[]   // top 3 total (includes topMatch as [0])
}

// ── Alias normalisation ───────────────────────────────────────────────────────

/** Normalise a search phrase for alias storage/lookup: lowercase, trim, collapse spaces. */
export function normaliseAlias(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ── Delivery info extraction ──────────────────────────────────────────────────

export type DeliveryInfo = {
  address:   string | null
  recipient: string | null
  phone:     string | null
}

/**
 * Heuristically extract delivery recipient, phone, and address from raw pasted text.
 * Used for the text-paste tab; photo/PDF use Claude instead.
 */
export function extractDeliveryInfo(text: string): DeliveryInfo {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let address:   string | null = null
  let recipient: string | null = null
  let phone:     string | null = null

  // Malaysian mobile/landline: 01X-XXXXXXX, 03-XXXXXXXX, +601X...
  const MY_PHONE = /(?:\+?60|0)[1-9][0-9][-\s]?[0-9]{7,8}/

  for (const line of lines) {
    if (!recipient) {
      const m = line.match(/^(?:attn|attention|recipient|contact(?:\s+person)?|c\/o|pic|deliver(?:y)?\s+to|to)\s*[:：\-]\s*(.+)/i)
      if (m?.[1] && m[1].length < 100) { recipient = m[1].trim(); continue }
    }
    if (!phone) {
      const kw = line.match(/^(?:tel|phone|hp|mobile|fax|h\/p|whatsapp|wa|handphone)\s*[:：]?\s*(.+)/i)
      if (kw) {
        const num = kw[1].match(MY_PHONE)
        if (num) { phone = num[0].replace(/\s/g, ''); continue }
      }
      // Standalone phone number line (little non-digit chars)
      const standalone = line.match(MY_PHONE)
      if (standalone && line.replace(/[\d\s\-()+]/g, '').length < 4) {
        phone = standalone[0].replace(/\s/g, ''); continue
      }
    }
    if (!address) {
      const kw = line.match(/^(?:deliver(?:y)?(?:\s*address)?|ship(?:ping)?(?:\s*address)?|address|alamat)\s*[:：]\s*(.+)/i)
      if (kw?.[1]) { address = kw[1].trim(); continue }
      // Line containing a Malaysian postcode (40000–99999) is likely an address line
      if (/\b[4-9][0-9]{4}\b/.test(line) && line.length > 8 && line.length < 300) {
        address = line
      }
    }
  }

  return { address, recipient, phone }
}

// ── Unit normalisation ────────────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  boxes: 'box', bx: 'box',
  reams: 'ream', rim: 'ream', rims: 'ream',
  rolls: 'roll',
  packs: 'pack', packet: 'pack', packets: 'pack', pkt: 'pack',
  pieces: 'pc', pcs: 'pc', piece: 'pc', pce: 'pc',
  dozens: 'dozen', dz: 'dozen',
  sets: 'set',
  bottles: 'bottle', btl: 'bottle', btls: 'bottle',
  cartons: 'carton', ctn: 'carton', ctns: 'carton',
  units: 'unit', unit: 'unit',
  tube: 'tube', tubes: 'tube',
}

function normaliseUnit(u: string): string {
  const lower = u.toLowerCase().trim()
  return UNIT_MAP[lower] ?? lower
}

// ── Line parser ───────────────────────────────────────────────────────────────

/**
 * Returns true for header/intro sentences that should be skipped — not product lines.
 * e.g. "I would like to request a quotation for Stationeries as per items below listed:"
 */
function isHeaderOrIntroLine(text: string): boolean {
  // Ends with colon → section header
  if (text.trimEnd().endsWith(':')) return true
  // Starts with common intro phrases
  if (/^(i would like|please|dear|hello|hi |thank|to:|from:|subject:|re:|attention:|regards|note:|as per|kindly|we would like|we are|the following|please find|herewith|below (is|are)|attached)/i.test(text)) return true
  // Long sentence (>80 chars) with no digits — unlikely to be a product line
  if (text.length > 80 && !/\d/.test(text)) return true
  return false
}

/**
 * parseItemList
 * Splits a multi-line text blob into structured ParsedLine objects.
 *
 * Handles formats like:
 *   "1. Faber Castel Gel Pen - Blue x 2 box"
 *   "Artline 90 Marker Black 2 pcs"
 *   "A4 Paper 80gsm 1rim"
 *   "• Calculator x 1"
 *   "5 boxes A4 Paper"
 *   "Whiteboard Marker – Black – 2pcs"   (dash-suffix qty)
 *   "A3 Paper 70gsm – 5reams"            (dash-suffix qty+unit)
 *   "Glue Stick -3pcs"                   (hyphen-suffix qty)
 */
export function parseItemList(rawText: string): ParsedLine[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !isHeaderOrIntroLine(l))

  return lines.map(line => parseSingleLine(line)).filter((l): l is ParsedLine => l !== null)
}

function parseSingleLine(raw: string): ParsedLine | null {
  let text = raw

  // Strip leading bullets / numbering  "1." "1)" "•" "-" "*"
  text = text.replace(/^[\d]+[.)]\s*/, '').replace(/^[•\-\*]\s*/, '').trim()
  if (!text) return null

  // Pattern 0: dash/em-dash separated qty suffix at end
  //   e.g. "Whiteboard Marker – Black – 2pcs"  → name="Whiteboard Marker – Black", qty=2, unit=pc
  //   e.g. "A3 Paper 70gsm – 5reams"           → name="A3 Paper 70gsm", qty=5, unit=ream
  //   e.g. "Glue Stick -3pcs"                  → name="Glue Stick", qty=3, unit=pc
  //   e.g. "Whiteboard 4ft x 8ft – 1 unit"     → name="Whiteboard 4ft x 8ft", qty=1, unit=unit
  // Dimension units (ft, cm, mm, m, kg…) are excluded so size specs aren't treated as qty.
  const DIMENSION_UNITS = new Set(['ft', 'cm', 'mm', 'm', 'inch', 'in', 'kg', 'g', 'l', 'ml', 'ltr'])
  const dashParts = text.split(/\s*[–—]\s*|\s+-\s*(?=\d)/)
  if (dashParts.length >= 2) {
    const lastPart  = dashParts[dashParts.length - 1].trim()
    const dashQty   = lastPart.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/)
    if (dashQty) {
      const rawUnit = dashQty[2] ? dashQty[2].toLowerCase() : null
      if (!rawUnit || !DIMENSION_UNITS.has(rawUnit)) {
        return {
          rawText:    raw,
          parsedName: dashParts.slice(0, -1).join(' – ').trim(),
          qty:        parseFloat(dashQty[1]),
          unit:       rawUnit ? normaliseUnit(rawUnit) : null,
        }
      }
    }
  }

  // Pattern 1: "... x N unit" or "... × N unit" or "... X N unit" at end
  //   e.g. "Artline 90 x 2 box"  →  name="Artline 90", qty=2, unit=box
  const trailX = text.match(/^(.+?)\s+[xX×]\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/i)
  if (trailX) {
    return {
      rawText:    raw,
      parsedName: trailX[1].trim(),
      qty:        parseFloat(trailX[2]),
      unit:       trailX[3] ? normaliseUnit(trailX[3]) : null,
    }
  }

  // Pattern 2: "N unit productName" at start
  //   e.g. "2 boxes A4 Paper" → qty=2, unit=box, name=A4 Paper
  const leadQtyUnit = text.match(/^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)\s+(.+)$/)
  if (leadQtyUnit && UNIT_MAP[leadQtyUnit[2].toLowerCase()]) {
    return {
      rawText:    raw,
      parsedName: leadQtyUnit[3].trim(),
      qty:        parseFloat(leadQtyUnit[1]),
      unit:       normaliseUnit(leadQtyUnit[2]),
    }
  }

  // Pattern 3: trailing number (no unit keyword)
  //   e.g. "A4 Paper 80gsm 10" → name=A4 Paper 80gsm, qty=10
  const trailNum = text.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/)
  if (trailNum && !isNaN(parseFloat(trailNum[2]))) {
    const maybeUnit = trailNum[1].split(/\s+/).pop() ?? ''
    if (UNIT_MAP[maybeUnit.toLowerCase()] || /^(box|roll|ream|rim|pcs|pc|set|pack|bottle|carton|dozen|tube|unit)$/i.test(maybeUnit)) {
      // last word is a unit — "10 box" at end → unit embedded
      return {
        rawText:    raw,
        parsedName: trailNum[1].replace(new RegExp(`\\s+${maybeUnit}$`, 'i'), '').trim(),
        qty:        parseFloat(trailNum[2]),
        unit:       normaliseUnit(maybeUnit),
      }
    }
    return {
      rawText:    raw,
      parsedName: trailNum[1].trim(),
      qty:        parseFloat(trailNum[2]),
      unit:       null,
    }
  }

  // Pattern 4: "NunitProductName" — no spaces e.g. "10ream A4 Paper"
  const stickyNum = text.match(/^(\d+)\s*([a-zA-Z]+)\s+(.+)$/)
  if (stickyNum && UNIT_MAP[stickyNum[2].toLowerCase()]) {
    return {
      rawText:    raw,
      parsedName: stickyNum[3].trim(),
      qty:        parseFloat(stickyNum[1]),
      unit:       normaliseUnit(stickyNum[2]),
    }
  }

  // Fallback: entire line = product name, qty = 1
  return {
    rawText:    raw,
    parsedName: text,
    qty:        1,
    unit:       null,
  }
}

// ── Layer 3: Product type fence ───────────────────────────────────────────────
// If the user's query contains one of these unambiguous product nouns,
// only products whose name also contains that noun are shown.
// Prevents e.g. "ruler" matching a cutting mat due to shared "30 cm" tokens.
const PRODUCT_TYPE_FENCE = new Set([
  'ruler', 'calculator', 'shredder', 'laminator', 'stapler',
  'scissors', 'punch', 'dispenser',
])

// ── Token-based fuzzy scorer ──────────────────────────────────────────────────

/**
 * Tokenise a string: lowercase, strip punctuation, split on whitespace.
 * Filter single-char tokens and common stop words.
 */
// Stop words: common English words AND generic office-supply adjectives that
// appear in many unrelated product names (e.g. "light" matches "STROBE LIGHT")
const STOP_WORDS = new Set([
  'and', 'the', 'of', 'for', 'with', 'a', 'an', 'in', 'on', 'to', 'or',
  // Generic adjectives that are too common in product catalogue to be useful
  'duty', 'heavy', 'light', 'size', 'type', 'style', 'new', 'mini',
  'standard', 'regular', 'large', 'small', 'medium', 'colour', 'color',
  'premium', 'deluxe', 'super', 'ultra', 'extra', 'plus',
])

/**
 * Lightweight plural stemmer for stationery terms.
 * batteries→battery, boxes→box, pencils→pencil, erasers→eraser
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y'
  if (token.length > 4 && token.endsWith('es') && !token.endsWith('sses')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

// Expand metric dimension tokens to imperial equivalents so queries like
// "Ruler 30cm" also generate the token "12" (12 inches) and match products
// named "RULER 12"".  Appends the converted value rather than replacing so
// both forms land in the token set.
function expandQueryUnits(s: string): string {
  return s.replace(/\b(\d+(?:\.\d+)?)\s*cm\b/gi, (match, n) => {
    const inches = Math.round(parseFloat(n) / 2.54)
    return `${match} ${inches}`   // "30cm" → "30cm 12"
  })
}

function tokenise(s: string): Set<string> {
  const raw = s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem)

  const result = new Set<string>()
  for (const t of raw) {
    // Normalise "30cm" → "30" + "cm" (replace compound, don't keep it).
    // This makes "30cm" in a query match "30 cm" in a product name and vice-versa,
    // because both sides tokenise to the same parts.
    // Guard: numeric part must be len≥2 so "2b" (pencil grade) and "3m" (brand)
    // are NOT split — their numeric part is single-digit, fails the guard.
    const dim = t.match(/^(\d+(?:\.\d+)?)([a-z]{2,4})$/)
    if (dim && dim[1]!.length >= 2) {
      result.add(dim[1]!)   // "30"
      result.add(dim[2]!)   // "cm"
      // Compound form "30cm" intentionally omitted — normalises both sides equally
    } else {
      result.add(t)
    }
  }
  return result
}

/**
 * Jaccard similarity of two token sets.
 * Bonus:
 *  +0.25 if query contains the product's brand name
 *  +0.30 if qneItemCode exactly matches a token in the query
 */
function scoreMatch(
  queryTokens: Set<string>,
  rawQuery:    string,
  product:     { name: string; brand: string | null; qneItemCode: string | null },
): number {
  const nameTokens = tokenise(product.name)
  if (nameTokens.size === 0 || queryTokens.size === 0) return 0

  const intersection = [...queryTokens].filter(t => nameTokens.has(t)).length

  // Require at least 2 meaningful token hits for queries with 2+ tokens,
  // to prevent single-word coincidences (e.g. "soft" in "G'SOFT" matching "Soft Eraser")
  if (queryTokens.size >= 2 && intersection < 2) return 0

  const union = new Set([...queryTokens, ...nameTokens]).size
  let score = union === 0 ? 0 : intersection / union

  // Single-token query (e.g. "Calculator", "Eraser"): if the token exactly
  // appears in the product name, guarantee at least medium confidence.
  // Without this, a 1-token query against a 4-token product name scores ≤ 0.25.
  if (queryTokens.size === 1 && intersection === 1) {
    score = Math.max(score, 0.35)
  }

  // Brand bonus — if brand appears in the query
  if (product.brand) {
    const brandTokens = tokenise(product.brand)
    const brandHits   = [...brandTokens].filter(t => queryTokens.has(t)).length
    if (brandHits > 0) score += 0.25
  }

  // QNE code exact bonus
  if (product.qneItemCode) {
    const codeNorm = product.qneItemCode.toLowerCase().replace(/[^a-z0-9]/g, '')
    const queryNorm = rawQuery.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (codeNorm.length > 2 && queryNorm.includes(codeNorm)) score += 0.30
  }

  return Math.min(score, 1.0)
}

// ── Main matcher ─────────────────────────────────────────────────────────────

type CatalogueProduct = {
  id:               string
  name:             string
  brand:            string | null
  unit:             string | null
  qneItemCode:      string | null
  isVisible:        boolean        // isVisibleToCustomers — our proxy for "in stock"
  orderFreq:        number         // times in confirmed QNE Sales Invoices (synced by syncQneInvoiceFreq.ts)
  availableQty:     number | null  // QNE stock; null = not yet synced
  parentCategoryName: string | null
  category:         { name: string }
  // Prices pre-computed at cache-fill time (Decimal-free, safe for Redis JSON)
  sellingPrice:             string | null
  currency:                 string
  supplierPriceVersionId:   string | null
}

// Compiled rule from a ProductBrandPreference DB row
type BrandPrefRule = {
  keywordTokens: string[]   // tokenised keywords that activate this rule
  brandTokens:   string[]   // tokenised brand names to match against product.brand
  boost:         number
}

type CatalogueCache = {
  products:       CatalogueProduct[]
  globalMargin:   string
  brandPrefRules: BrandPrefRule[]
}

// ── Cache config ──────────────────────────────────────────────────────────────
// L1: in-process (per Vercel worker instance, 5-min TTL, zero network)
// L2: Upstash Redis (shared across all instances, 5-min TTL)
// L3: Postgres via Prisma (source of truth)

let _cache: CatalogueCache | null = null
let _cacheFetchedAt: number = 0
const CATALOGUE_TTL_MS = 5 * 60_000      // 5 minutes (in-process TTL check)
const CATALOGUE_TTL_S  = 5 * 60          // 5 minutes (Redis ex seconds)
const CATALOGUE_REDIS_KEY = 'flexxo:smart-order:catalogue:v1'

async function fetchCatalogue(): Promise<CatalogueCache> {
  // L1: in-process cache (fastest — avoids Redis round-trip on warm instances)
  if (_cache && Date.now() - _cacheFetchedAt < CATALOGUE_TTL_MS) {
    return _cache
  }

  // L2: Redis (shared across all Vercel instances — survives cold starts)
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get<CatalogueCache>(CATALOGUE_REDIS_KEY)
      if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
        _cache          = cached
        _cacheFetchedAt = Date.now()
        return cached
      }
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  // L3: DB query (only runs on true cold start or after cache invalidation)
  const [products, globalSetting, brandPrefs] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id:                   true,
        name:                 true,
        brand:                true,
        unit:                 true,
        qneItemCode:          true,
        isVisibleToCustomers: true,
        qneAvailableQty:      true,
        qneInvoiceFreq:       true,
        defaultMarginPct:     true,
        category: { select: { name: true, defaultMarginPct: true, parentCategory: { select: { name: true } } } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { id: true, costPrice: true, currency: true },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
    prisma.productBrandPreference.findMany({ where: { isActive: true } }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  // Compile brand pref DB rows into fast token-based rules
  const brandPrefRules: BrandPrefRule[] = brandPrefs.map(p => ({
    keywordTokens: p.keywords.split(',').flatMap(k => [...tokenise(k)]),
    brandTokens:   p.brands.split(',').flatMap(b => [...tokenise(b)]),
    boost:         Number(p.boostMultiplier),
  }))

  // Pre-compute selling prices here so CatalogueProduct is Decimal-free
  // (plain strings/numbers survive Redis JSON serialization round-trips)
  const enriched: CatalogueProduct[] = products.map(p => {
    const price = p.priceVersions[0] ?? null
    let sellingPrice: string | null           = null
    let currency                              = 'MYR'
    let supplierPriceVersionId: string | null = null
    if (price) {
      sellingPrice           = _calcSellingPrice(price.costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin).toString()
      currency               = price.currency
      supplierPriceVersionId = price.id
    }
    return {
      id:                     p.id,
      name:                   p.name,
      brand:                  p.brand,
      unit:                   p.unit,
      qneItemCode:            p.qneItemCode,
      isVisible:              p.isVisibleToCustomers,
      orderFreq:              p.qneInvoiceFreq,
      availableQty:           p.qneAvailableQty ?? null,
      parentCategoryName:     p.category.parentCategory?.name ?? null,
      category:               { name: p.category.name },
      sellingPrice,
      currency,
      supplierPriceVersionId,
    }
  })

  const result: CatalogueCache = { products: enriched, globalMargin, brandPrefRules }

  // Populate both caches
  _cache          = result
  _cacheFetchedAt = Date.now()
  redis?.set(CATALOGUE_REDIS_KEY, result, { ex: CATALOGUE_TTL_S }).catch(() => undefined)

  return result
}

function getProductPrice(p: CatalogueProduct): { selling: string | null; currency: string; versionId: string | null } {
  return { selling: p.sellingPrice, currency: p.currency, versionId: p.supplierPriceVersionId }
}

/**
 * matchProductsForLines
 * Takes parsed lines and scores each against the full product catalogue.
 * Returns MatchedLine[] with confidence tiers and top-3 alternatives.
 *
 * companyId: optional — when provided, previously-bought products/brands get a boost.
 */
export async function matchProductsForLines(lines: ParsedLine[], companyId?: string): Promise<MatchedLine[]> {
  const { products: catalogue, brandPrefRules } = await fetchCatalogue()

  // Layer 2: load customer purchase history (approved/sent/accepted quotes only)
  const companyProductIds  = new Set<string>()
  const companyBrandTokens = new Set<string>()
  if (companyId) {
    const quotations = await prisma.quotation.findMany({
      where:  { companyId, status: { in: ['approved', 'sent', 'accepted'] } },
      select: { id: true },
    })
    if (quotations.length > 0) {
      const qIds  = quotations.map(q => q.id)
      const items = await prisma.quotationItem.findMany({
        where:  { quotationId: { in: qIds }, productId: { not: null } },
        select: { productId: true, product: { select: { brand: true } } },
      })
      for (const item of items) {
        if (item.productId) companyProductIds.add(item.productId)
        if (item.product?.brand) {
          for (const t of tokenise(item.product.brand)) companyBrandTokens.add(t)
        }
      }
    }
  }

  // Tier 0: alias lookup — exact match wins immediately, skips all fuzzy logic
  const normalisedQueries = lines.map(l => normaliseAlias(l.parsedName))
  const aliasRows = await prisma.productAlias.findMany({
    where:  { alias: { in: normalisedQueries } },
    select: { alias: true, productId: true },
  })
  const aliasMap = new Map(aliasRows.map(r => [r.alias, r.productId]))

  return lines.map(line => {
    // Tier 0: direct alias hit
    const normQuery      = normaliseAlias(line.parsedName)
    const aliasProductId = aliasMap.get(normQuery)
    if (aliasProductId) {
      const p = catalogue.find(c => c.id === aliasProductId)
      if (p) {
        const { selling, currency, versionId } = getProductPrice(p)
        const match: ProductMatch = {
          id:                     p.id,
          name:                   p.name,
          brand:                  p.brand,
          unit:                   p.unit,
          qneItemCode:            p.qneItemCode,
          categoryName:           p.category.name,
          sellingPrice:           selling,
          currency,
          supplierPriceVersionId: versionId,
          score:                  1.0,
          isVisible:              p.isVisible,
          orderFreq:              p.orderFreq,
          availableQty:           p.availableQty,
        }
        return { ...line, confidence: 'high' as const, topMatch: match, alternatives: [match] }
      }
    }

    const expandedName = expandQueryUnits(line.parsedName)
    const queryTokens  = tokenise(expandedName)
    const rawQuery     = line.parsedName

    // Layer 1: find which brand preference rules apply to this query
    const activeBrandBoosts = brandPrefRules.filter(rule =>
      rule.keywordTokens.length > 0 &&
      rule.keywordTokens.every(k => queryTokens.has(k)),
    )

    // Layer 3: collect fence nouns present in the query
    const fenceNouns = [...queryTokens].filter(t => PRODUCT_TYPE_FENCE.has(t))

    // Score all products
    const scored = catalogue.map(p => {
      let rawScore = scoreMatch(queryTokens, rawQuery, p)

      // Brand-preference floor: if a brand pref rule is active AND this product's brand
      // matches that rule, but rawScore is 0 only because the 2-token intersection guard
      // fired (e.g. query "Soft Eraser" → FC eraser has "eraser" but not "soft"), give it
      // a floor score so the brand boost can still apply.
      // Without this fix, 0 × 1.6 = 0 — the boost is useless against a zero.
      let wasBrandBoosted = false
      if (rawScore === 0 && activeBrandBoosts.length > 0) {
        const productBrandTokens = [...tokenise(p.brand ?? '')]
        const matchingRule = activeBrandBoosts.find(rule =>
          rule.brandTokens.some(bt => productBrandTokens.includes(bt))
        )
        if (matchingRule) {
          const nameTokens = tokenise(p.name)
          const singleHit  = [...queryTokens].some(t => nameTokens.has(t))
          if (singleHit) rawScore = 0.15   // floor: just enough to enable boosts
        }
      }

      let adjustedScore = rawScore
      if (rawScore >= 0.15) {
        // Stock boost — stocked items score 35% higher
        if (p.isVisible) adjustedScore = rawScore * 1.35

        // APLUS house-brand boost within Office Stationery (global default)
        if (p.parentCategoryName === 'Office Stationery' && (p.brand ?? '').toUpperCase() === 'APLUS') {
          adjustedScore *= 1.3
        }

        // Layer 1: preferred brand boost (product-type specific)
        if (activeBrandBoosts.length > 0) {
          const productBrandTokens = [...tokenise(p.brand ?? '')]
          for (const rule of activeBrandBoosts) {
            if (rule.brandTokens.some(bt => productBrandTokens.includes(bt))) {
              adjustedScore *= rule.boost
              wasBrandBoosted = true
              break  // apply highest-priority rule only
            }
          }
        }

        // QNE invoice frequency bonus
        adjustedScore += Math.min(p.orderFreq, 20) * 0.004

        // Layer 2: customer history boost
        if (companyId) {
          if (companyProductIds.has(p.id)) {
            adjustedScore *= 2.0   // exact item previously bought by this company
          } else if ([...tokenise(p.brand ?? '')].some(t => companyBrandTokens.has(t))) {
            adjustedScore *= 1.3   // brand previously bought by this company
          }
        }
      }

      return { product: p, score: rawScore, adjustedScore, wasBrandBoosted }
    })

    // Sort: adjustedScore first. On near-ties (within 0.001), brand-boosted products win
    // over non-boosted — prevents a shorter-named rival beating the preferred brand on
    // Jaccard alone when the admin explicitly configured a brand preference rule.
    scored.sort((a, b) => {
      const diff = b.adjustedScore - a.adjustedScore
      if (Math.abs(diff) > 0.001) return diff
      if (a.wasBrandBoosted !== b.wasBrandBoosted) return a.wasBrandBoosted ? -1 : 1
      return b.score - a.score
    })

    const top3 = scored
      .filter(s => {
        if (s.adjustedScore < 0.15) return false
        if (s.product.availableQty === 0) return false
        // Layer 3: fence — product name must contain the primary noun
        if (fenceNouns.length > 0) {
          const prodTokens = tokenise(s.product.name)
          if (!fenceNouns.some(noun => prodTokens.has(noun))) return false
        }
        return true
      })
      .slice(0, 3)

    const alternatives: ProductMatch[] = top3.map(({ product: p, score, adjustedScore }) => {
      const { selling, currency, versionId } = getProductPrice(p)
      return {
        id:                     p.id,
        name:                   p.name,
        brand:                  p.brand,
        unit:                   p.unit,
        qneItemCode:            p.qneItemCode,
        categoryName:           p.category.name,
        sellingPrice:           selling,
        currency,
        supplierPriceVersionId: versionId,
        score:                  Math.min(adjustedScore, 1.0),  // cap at 1.0 for display; business priority baked in
        isVisible:              p.isVisible,
        orderFreq:              p.orderFreq,
        availableQty:           p.availableQty,
      }
    })

    const topMatch = alternatives[0] ?? null
    const topScore = topMatch?.score ?? 0

    const confidence: 'high' | 'medium' | 'none' =
      topScore >= 0.55 ? 'high'   :
      topScore >= 0.28 ? 'medium' :
      'none'

    return {
      ...line,
      confidence,
      topMatch,
      alternatives,
    }
  })
}

/** Invalidate the in-memory and Redis catalogue cache (call after product/brand-pref updates). */
export function invalidateCatalogueCache(): void {
  _cache          = null
  _cacheFetchedAt = 0
  getRedis()?.del(CATALOGUE_REDIS_KEY).catch(() => undefined)
}
