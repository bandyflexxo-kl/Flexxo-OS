/**
 * lib/smartOrder.ts
 * Smart Order — parse a pasted item list + fuzzy-match each line to the
 * product catalogue.  Used by /api/smart-order/* routes.
 *
 * No AI required for text input; AI (Claude Vision) is used only in the
 * scan-image route to extract text from a photo before calling parseItemList.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@/app/generated/prisma/client'

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
  orderFreq:              number    // # of times quoted across all quotations
}

export type MatchedLine = ParsedLine & {
  confidence:   'high' | 'medium' | 'none'
  topMatch:     ProductMatch | null
  alternatives: ProductMatch[]   // top 3 total (includes topMatch as [0])
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
 * parseItemList
 * Splits a multi-line text blob into structured ParsedLine objects.
 *
 * Handles formats like:
 *   "1. Faber Castel Gel Pen - Blue x 2 box"
 *   "Artline 90 Marker Black 2 pcs"
 *   "A4 Paper 80gsm 1rim"
 *   "• Calculator x 1"
 *   "5 boxes A4 Paper"
 */
export function parseItemList(rawText: string): ParsedLine[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  return lines.map(line => parseSingleLine(line)).filter((l): l is ParsedLine => l !== null)
}

function parseSingleLine(raw: string): ParsedLine | null {
  let text = raw

  // Strip leading bullets / numbering  "1." "1)" "•" "-" "*"
  text = text.replace(/^[\d]+[.)]\s*/, '').replace(/^[•\-\*]\s*/, '').trim()
  if (!text) return null

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

function tokenise(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t)),
  )
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

  // Require at least 2 meaningful token hits for queries with 3+ tokens,
  // to prevent single-word coincidences (e.g. "light" in "STROBE LIGHT")
  if (queryTokens.size >= 3 && intersection < 2) return 0

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
  isVisible:        boolean          // isVisibleToCustomers — our proxy for "in stock"
  orderFreq:        number           // historical quotation count (most-ordered signal)
  category:         { name: string; defaultMarginPct: Prisma.Decimal | null }
  defaultMarginPct: Prisma.Decimal | null
  priceVersions:    Array<{
    id:        string
    costPrice: Prisma.Decimal
    currency:  string
  }>
}

type CatalogueCache = {
  products:     CatalogueProduct[]
  globalMargin: string
}

let _cache: CatalogueCache | null = null
let _cacheFetchedAt: number = 0
const CATALOGUE_TTL_MS = 5 * 60_000 // 5 minutes

async function fetchCatalogue(): Promise<CatalogueCache> {
  if (_cache && Date.now() - _cacheFetchedAt < CATALOGUE_TTL_MS) {
    return _cache
  }

  const [products, globalSetting, freqRows] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id:                   true,
        name:                 true,
        brand:                true,
        unit:                 true,
        qneItemCode:          true,
        isVisibleToCustomers: true,
        defaultMarginPct:     true,
        category: { select: { name: true, defaultMarginPct: true } },
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
    // Aggregate historical quotation frequency per product (most-ordered signal)
    prisma.quotationItem.groupBy({
      by:    ['productId'],
      where: { productId: { not: null } },
      _count: { productId: true },
    }),
  ])

  const freqMap = new Map(freqRows.map(r => [r.productId!, r._count.productId]))

  const enriched = (products as Array<typeof products[0] & { isVisibleToCustomers: boolean }>).map(p => ({
    ...p,
    isVisible: p.isVisibleToCustomers,
    orderFreq: freqMap.get(p.id) ?? 0,
  }))

  _cache = {
    products:     enriched as unknown as CatalogueProduct[],
    globalMargin: globalSetting?.value ?? '30',
  }
  _cacheFetchedAt = Date.now()
  return _cache
}

function getProductPrice(
  p:            CatalogueProduct,
  globalMargin: string,
): { selling: string | null; currency: string; versionId: string | null } {
  const price = p.priceVersions[0] ?? null
  if (!price) return { selling: null, currency: 'MYR', versionId: null }

  const selling = _calcSellingPrice(
    price.costPrice,
    p.defaultMarginPct,
    p.category.defaultMarginPct,
    globalMargin,
  )
  return {
    selling:   selling.toString(),
    currency:  price.currency,
    versionId: price.id,
  }
}

/**
 * matchProductsForLines
 * Takes parsed lines and scores each against the full product catalogue.
 * Returns MatchedLine[] with confidence tiers and top-3 alternatives.
 */
export async function matchProductsForLines(lines: ParsedLine[]): Promise<MatchedLine[]> {
  const { products: catalogue, globalMargin } = await fetchCatalogue()

  return lines.map(line => {
    const queryTokens = tokenise(line.parsedName)
    const rawQuery    = line.parsedName

    // Score all products
    const scored = catalogue.map(p => {
      const rawScore = scoreMatch(queryTokens, rawQuery, p)

      // ── Business priority adjustments (Principle: stock first → most ordered → best match) ──
      // Only adjust candidates that already pass minimum threshold (avoids inflating junk)
      let adjustedScore = rawScore
      if (rawScore >= 0.15) {
        // 1. Stocked items (isVisibleToCustomers=true) get a 35% boost.
        //    Effect: a stocked product at 0.59 beats a non-stocked product at 0.79.
        if (p.isVisible) adjustedScore = rawScore * 1.35
        // 2. Order-frequency bonus — cap contribution at +0.08 (20 orders = +0.08)
        adjustedScore += Math.min(p.orderFreq, 20) * 0.004
      }

      return { product: p, score: rawScore, adjustedScore }
    })

    // Sort by adjustedScore (stock/freq priority), fall back to rawScore for ties
    scored.sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score)
    const top3 = scored.slice(0, 3).filter(s => s.adjustedScore >= 0.15)

    const alternatives: ProductMatch[] = top3.map(({ product: p, score, adjustedScore }) => {
      const { selling, currency, versionId } = getProductPrice(p, globalMargin)
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

/** Invalidate the in-memory catalogue cache (call after product updates). */
export function invalidateCatalogueCache(): void {
  _cache           = null
  _cacheFetchedAt  = 0
}
