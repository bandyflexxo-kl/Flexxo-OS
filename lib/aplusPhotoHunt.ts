import 'server-only'
import { prisma } from '@/lib/prisma'
import { uploadProductPhoto } from '@/lib/supabaseStorage'
import { scanPhotoUrl } from '@/lib/photoQuality'
import type { Prisma } from '@/generated/prisma/client'

/**
 * APLUS photo hunt — find product photos for unmatched/flagged APLUS items on
 * the APLUS retailer STP (stpstationery.com.my) first, then other Malaysian
 * stationery retailers. Nothing goes live: found photos are attached with
 * photoApprovalPending=true and quality-scanned, then surface in the Photo
 * Review "pending" queue for a human ✔.
 *
 * Precision guard (verified 2 Jul 2026): STP's SKU codes often differ from
 * Flexxo's APLUS codes (PL3000 → STP PL3888/PL2888), so we tier every result:
 *   - 'exact'   : the product's model code appears in the image title/source URL
 *   - 'similar' : no code hit, but name token-Jaccard ≥ 0.5 (reviewer verifies variant)
 *   - 'none'    : nothing acceptable — left untouched for manual handling
 */

const SERPER_IMAGES = 'https://google.serper.dev/images'
const ALLOWED_MIME  = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

// Source-domain priority — STP (the APLUS retailer the user pointed us at) wins,
// then other known Malaysian APLUS-carrying retailers, then everything else.
const STP_DOMAIN = 'stpstationery.com.my'
const KNOWN_MY_RETAILERS = [
  'youlin.com.my', 'gsstationery.com', 'officeplus.com.my', 'fivestarstationery.com.my',
  'dkstmall.com', 'becon.my', 'paper.com.my', 'wellstationerymart.com', 'cpstationery.com.my',
]

export type HuntTier = 'exact' | 'similar' | 'none'
export type HuntResult = {
  productId: string
  name:      string
  code:      string | null
  tier:      HuntTier
  source?:   string | null   // domain the photo came from
  imageUrl?: string | null   // original candidate URL (pre-upload)
  photoUrl?: string | null   // Supabase CDN URL after upload
  flagged?:  boolean         // AI quality scan verdict
  reason?:   string          // scan reason / skip reason
}

/** Prisma filter for the hunt target set: APLUS + (no photo at all OR flagged). */
export const aplusTargetWhere: Prisma.ProductWhereInput = {
  isActive: true,
  brand:    { equals: 'APLUS', mode: 'insensitive' },
  OR: [
    { photoUrl: null, googleDrivePhotoId: null },
    { photoQualityFlagged: true },
  ],
}

function key(): string {
  return (process.env.SERPER_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '')
}

/** "APLUSPL3000" / "APLUS PL3000" → "PL3000". Falls back to internalSku. */
export function aplusCode(qneItemCode: string | null, internalSku: string | null): string | null {
  const raw = (qneItemCode ?? internalSku ?? '').trim()
  if (!raw) return null
  const stripped = raw.replace(/^A[- ]?PLUS[- ]?/i, '').trim()
  return stripped || raw
}

/** Uppercase, keep only alphanumerics — for tolerant code containment checks. */
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

function tokenise(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length >= 2),
  )
}
function jaccard(a: string, b: string): number {
  const A = tokenise(a), B = tokenise(b)
  if (A.size === 0 || B.size === 0) return 0
  const inter = [...A].filter(t => B.has(t)).length
  return inter / (A.size + B.size - inter)
}

/**
 * The numeric core of a code — longest run of ≥3 digits. "CS363"→"363",
 * "PL3000"→"3000", "NCH300"→"300". Retailers often drop Flexxo's letter prefix
 * (STP lists CS363 as bare "363"), so we match on this too, not just the full code.
 */
function codeCore(code: string | null): string | null {
  const runs = (code ?? '').match(/\d{3,}/g)
  return runs ? runs[runs.length - 1] : null
}

// Generic words stripped when building the short "variant" query — leaves the
// distinctive attribute words (colour, finish) that pin the right SKU.
const GENERIC_WORDS = new Set([
  'aplus', 'a3', 'a4', 'a5', 'gsm', 'color', 'colour', 'paper', 'card',
  'sheet', 'sheets', 'pkt', 'pcs', 'box', 'ream', 'set', 'pack', 'the', 'and', 'with',
])

/** Distinctive variant words from a name — brand, code, sizes, generic terms removed.
 *  "APLUS CS363 A4 80GSM COLOR PAPER CYBER YELLOW 450'S" → "cyber yellow". */
function variantWords(name: string, code: string | null): string {
  const codeN = code ? norm(code) : ''
  const core  = codeCore(code) ?? ''
  return [...tokenise(name)]
    .filter(t => {
      const tu = t.toUpperCase()
      if (GENERIC_WORDS.has(t)) return false
      if (/^\d+$/.test(t)) return false        // pure numbers (450, 100)
      if (/^\d+gsm$/.test(t)) return false      // 80gsm, 160gsm
      if (tu === codeN || tu === core) return false
      return true
    })
    .join(' ')
}

function domainRank(hay: string): number {
  const h = hay.toLowerCase()
  if (h.includes(STP_DOMAIN)) return 0
  if (KNOWN_MY_RETAILERS.some(d => h.includes(d))) return 1
  return 2
}

type SerperImage = { imageUrl?: string; title?: string; source?: string; link?: string; domain?: string }
type Candidate = { imageUrl: string; title: string; where: string; brand: boolean; codeHit: boolean; rank: number; jac: number }

async function searchImages(query: string): Promise<SerperImage[]> {
  try {
    const r = await fetch(SERPER_IMAGES, {
      method:  'POST',
      headers: { 'X-API-KEY': key(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: query, gl: 'my', num: 12 }),
      signal:  AbortSignal.timeout(20_000),
    })
    if (!r.ok) return []
    const d = await r.json() as { images?: SerperImage[] }
    return d.images ?? []
  } catch { return [] }
}

/**
 * Rank candidates. Priority order (own brand FIRST — an APLUS-branded photo
 * beats a competitor's even when the competitor's spec text matches better):
 *   1. APLUS present in source/title
 *   2. code hit (full code OR numeric core)
 *   3. domain (STP > known MY retailer > other)
 *   4. name similarity
 */
function rankCandidates(imgs: SerperImage[], code: string | null, core: string | null, name: string): Candidate[] {
  const codeN = code ? norm(code) : ''
  return imgs
    .filter(i => i.imageUrl?.startsWith('http'))
    .map(i => {
      const where = `${i.source ?? ''} ${i.domain ?? ''} ${i.link ?? ''} ${i.title ?? ''}`
      const w     = norm(where)
      const codeHit = (codeN.length >= 3 && w.includes(codeN)) || (!!core && w.includes(core))
      return {
        imageUrl: i.imageUrl!, title: i.title ?? '', where,
        brand: w.includes('APLUS'), codeHit,
        rank: domainRank(where), jac: jaccard(name, i.title ?? ''),
      }
    })
    .sort((a, b) => {
      if (a.brand !== b.brand) return a.brand ? -1 : 1         // own brand first
      if (a.codeHit !== b.codeHit) return a.codeHit ? -1 : 1    // then code / core hit
      if (a.rank !== b.rank) return a.rank - b.rank             // then STP > known > other
      return b.jac - a.jac                                      // then name similarity
    })
}

const JACCARD_MIN = 0.5

/**
 * Hunt one APLUS product. Searches, tiers, and (for exact/similar) downloads →
 * Supabase → sets photoUrl + photoApprovalPending=true → AI quality scan.
 * Tries successive candidates if a download is blocked. Pure DB side effects.
 */
export async function huntAplusPhotoForProduct(productId: string): Promise<HuntResult> {
  const product = await prisma.product.findUnique({
    where:  { id: productId },
    select: { id: true, name: true, qneItemCode: true, internalSku: true },
  })
  if (!product) return { productId, name: '', code: null, tier: 'none', reason: 'Product not found' }

  const code = aplusCode(product.qneItemCode, product.internalSku)
  const core = codeCore(code)
  const base = { productId, name: product.name, code }

  if (!key()) return { ...base, tier: 'none', reason: 'SERPER_API_KEY missing' }

  // Multi-query for recall: the full name catches exact-spec items; the short
  // "APLUS {code-core} {variant}" query surfaces the APLUS-branded listing (STP
  // labels e.g. "363", not "CS363"). Merge + dedupe candidates from both.
  const variant = variantWords(product.name, code)
  const queries = [
    `APLUS ${code ?? ''} ${product.name}`.replace(/\s+/g, ' ').trim(),
    `APLUS ${core ?? code ?? ''} ${variant}`.replace(/\s+/g, ' ').trim(),
  ].filter((q, i, a) => q.length > 5 && a.indexOf(q) === i)

  const merged = new Map<string, SerperImage>()
  for (const q of queries) {
    for (const img of await searchImages(q)) {
      if (img.imageUrl && !merged.has(img.imageUrl)) merged.set(img.imageUrl, img)
    }
  }
  const ranked = rankCandidates([...merged.values()], code, core, product.name)
  if (ranked.length === 0) return { ...base, tier: 'none', reason: 'No image results' }

  // Tier from the best-ranked candidate (brand-first sort already applied):
  //   exact   = APLUS-branded AND code/core hit
  //   similar = APLUS-branded, or a code / name match worth a human check
  const best = ranked[0]
  const tier: HuntTier =
    best.brand && best.codeHit         ? 'exact'
    : best.brand || best.codeHit || best.jac >= JACCARD_MIN ? 'similar'
    : 'none'
  if (tier === 'none') {
    return { ...base, tier: 'none', reason: 'No confident match (no APLUS-branded / code / name hit)' }
  }
  const pool = ranked   // sorted brand-first; try in order until one downloads

  // Try candidates in order until one downloads (sites often block hotlinking).
  for (const cand of pool.slice(0, 4)) {
    let imgRes: Response
    try {
      imgRes = await fetch(cand.imageUrl, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } })
    } catch { continue }
    if (!imgRes.ok) continue
    const mimeType = (imgRes.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!ALLOWED_MIME.has(mimeType)) continue

    const buffer = Buffer.from(await imgRes.arrayBuffer())
    if (buffer.length < 1024) continue   // skip 1x1 trackers / empty bodies

    const photoUrl = await uploadProductPhoto(product.id, buffer, mimeType)
    const domain   = (() => { try { return new URL(cand.imageUrl).hostname.replace(/^www\./, '') } catch { return null } })()

    // Attach + queue for human approval; clear any old flag before the fresh scan.
    await prisma.product.update({
      where: { id: product.id },
      data:  { photoUrl, photoApprovalPending: true, photoApprovedByAdmin: false, photoQualityFlagged: null, photoQualityNote: null },
    })

    // AI quality scan (user-approved pre-check). Best-effort — must not undo the
    // save. Pass 'APLUS' as the own-brand so its own packaging logo isn't flagged
    // as a competitor mark; only OTHER brands / printing overlays / watermarks flag.
    let flagged = false, scanReason = 'not scanned'
    try { const s = await scanPhotoUrl(product.id, photoUrl, 'APLUS'); flagged = s.flagged; scanReason = s.reason } catch { /* leave unscanned */ }

    // Preserve provenance in the note the reviewer sees (scanPhotoUrl overwrote it).
    await prisma.product.update({
      where: { id: product.id },
      data:  { photoQualityNote: `APLUS hunt (${tier}${domain ? `, ${domain}` : ''}) — ${scanReason}` },
    })

    return { ...base, tier, source: domain, imageUrl: cand.imageUrl, photoUrl, flagged, reason: scanReason }
  }

  return { ...base, tier: 'none', reason: 'Candidates found but none downloadable (hotlink-blocked)' }
}
