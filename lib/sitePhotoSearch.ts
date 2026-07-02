import 'server-only'
import { prisma } from '@/lib/prisma'
import { uploadProductPhoto } from '@/lib/supabaseStorage'
import { scanPhotoUrl } from '@/lib/photoQuality'

/**
 * Accurate bulk photo search — the admin gives ONE official website and selects
 * the products to match; we find each product's photo STRICTLY on that website
 * (candidates from any other domain are discarded). Found photos are downloaded
 * → Supabase → photoApprovalPending=true → brand-aware AI quality scan, and land
 * in the Photo Review "pending" queue. Nothing goes live without a human ✔.
 *
 * "Strictly on the given site" is enforced by domainMatches(): a candidate is
 * kept only when the target domain appears in its source / page link / image
 * host. This is what stops photos being pulled from other resellers (youlin,
 * etc.) when the admin asked for a specific site.
 */

const SERPER_IMAGES = 'https://google.serper.dev/images'
const ALLOWED_MIME  = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const JACCARD_MIN   = 0.4   // a bit lenient: the admin already vouched for this site

export type SiteTier = 'exact' | 'similar' | 'none'
export type SiteSearchResult = {
  productId: string
  name:      string
  code:      string | null
  tier:      SiteTier
  source?:   string | null   // domain the photo came from (== the requested site)
  imageUrl?: string | null
  photoUrl?: string | null
  flagged?:  boolean
  reason?:   string
}

function key(): string {
  return (process.env.SERPER_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '')
}

/** "https://www.stpstationery.com.my/aplus?x=1" → "stpstationery.com.my". */
export function normalizeDomain(input: string): string {
  let s = (input ?? '').trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split(/[/?#]/)[0]
  return s.trim()
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

function tokenise(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(t => t.length >= 2))
}
function jaccard(a: string, b: string): number {
  const A = tokenise(a), B = tokenise(b)
  if (A.size === 0 || B.size === 0) return 0
  const inter = [...A].filter(t => B.has(t)).length
  return inter / (A.size + B.size - inter)
}

/** Longest run of ≥3 digits — "CS363"→"363" (retailers often drop letter prefixes). */
function codeCore(code: string | null): string | null {
  const runs = (code ?? '').match(/\d{3,}/g)
  return runs ? runs[runs.length - 1] : null
}

const GENERIC_WORDS = new Set([
  'a3', 'a4', 'a5', 'gsm', 'color', 'colour', 'paper', 'card', 'sheet', 'sheets',
  'pkt', 'pcs', 'box', 'ream', 'set', 'pack', 'the', 'and', 'with',
])
/** Distinctive variant words (colour/finish) for the short query. */
function variantWords(name: string, brand: string | null, code: string | null): string {
  const codeN = code ? norm(code) : ''
  const core  = codeCore(code) ?? ''
  const brandN = brand ? norm(brand) : ''
  return [...tokenise(name)]
    .filter(t => {
      const tu = t.toUpperCase()
      if (GENERIC_WORDS.has(t)) return false
      if (/^\d+$/.test(t) || /^\d+gsm$/.test(t)) return false
      if (tu === codeN || tu === core || tu === brandN) return false
      return true
    })
    .join(' ')
}

type SerperImage = { imageUrl?: string; title?: string; source?: string; link?: string; domain?: string }
type Candidate = { imageUrl: string; title: string; codeHit: boolean; brand: boolean; jac: number }

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

/** True only when the candidate belongs to the requested site (source/link/image host). */
function domainMatches(i: SerperImage, domain: string): boolean {
  const hay = `${i.source ?? ''} ${i.domain ?? ''} ${i.link ?? ''} ${i.imageUrl ?? ''}`.toLowerCase()
  return hay.includes(domain)
}

/**
 * Search a single product's photo strictly on `website`. Returns the tier and,
 * for exact/similar, attaches the photo (pending review) + AI scan.
 */
export async function searchProductPhotoOnSite(productId: string, website: string): Promise<SiteSearchResult> {
  const domain  = normalizeDomain(website)
  const product = await prisma.product.findUnique({
    where:  { id: productId },
    select: { id: true, name: true, brand: true, qneItemCode: true, internalSku: true },
  })
  if (!product) return { productId, name: '', code: null, tier: 'none', reason: 'Product not found' }

  const code = (product.qneItemCode ?? product.internalSku ?? '').trim() || null
  const core = codeCore(code)
  const base = { productId, name: product.name, code }

  if (!key())    return { ...base, tier: 'none', reason: 'SERPER_API_KEY missing' }
  if (!domain)   return { ...base, tier: 'none', reason: 'No website given' }

  // Queries: a site-scoped one and keyword ones that include the domain — merged,
  // then strictly filtered to the domain so nothing off-site can slip through.
  const variant = variantWords(product.name, product.brand, code)
  const queries = [
    `site:${domain} ${product.name}`.trim(),
    `${product.brand ?? ''} ${core ?? code ?? ''} ${variant} ${domain}`.replace(/\s+/g, ' ').trim(),
    `${product.name} ${domain}`.replace(/\s+/g, ' ').trim(),
  ].filter((q, idx, a) => q.length > domain.length + 2 && a.indexOf(q) === idx)

  const merged = new Map<string, SerperImage>()
  for (const q of queries) {
    for (const img of await searchImages(q)) {
      if (img.imageUrl?.startsWith('http') && !merged.has(img.imageUrl)) merged.set(img.imageUrl, img)
    }
  }

  const codeN = code ? norm(code) : ''
  const onSite: (Candidate & { img: SerperImage })[] = [...merged.values()]
    .filter(i => domainMatches(i, domain))   // STRICT: only the requested site
    .map(i => {
      const w = norm(`${i.title ?? ''} ${i.link ?? ''} ${i.source ?? ''}`)
      return {
        img: i, imageUrl: i.imageUrl!, title: i.title ?? '',
        codeHit: (codeN.length >= 3 && w.includes(codeN)) || (!!core && w.includes(core)),
        brand:   !!product.brand && w.includes(norm(product.brand)),
        jac:     jaccard(product.name, i.title ?? ''),
      }
    })
    .sort((a, b) => {
      if (a.codeHit !== b.codeHit) return a.codeHit ? -1 : 1
      if (a.brand !== b.brand) return a.brand ? -1 : 1
      return b.jac - a.jac
    })

  if (onSite.length === 0) return { ...base, tier: 'none', reason: `Not found on ${domain}` }

  const best = onSite[0]
  const tier: SiteTier = best.codeHit ? 'exact' : (best.brand || best.jac >= JACCARD_MIN) ? 'similar' : 'none'
  if (tier === 'none') return { ...base, tier: 'none', reason: `On ${domain} but no confident code/name match` }

  for (const cand of onSite.slice(0, 4)) {
    let imgRes: Response
    try {
      imgRes = await fetch(cand.imageUrl, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } })
    } catch { continue }
    if (!imgRes.ok) continue
    const mimeType = (imgRes.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!ALLOWED_MIME.has(mimeType)) continue

    const buffer = Buffer.from(await imgRes.arrayBuffer())
    if (buffer.length < 1024) continue

    const photoUrl = await uploadProductPhoto(product.id, buffer, mimeType)
    await prisma.product.update({
      where: { id: product.id },
      data:  { photoUrl, photoApprovalPending: true, photoApprovedByAdmin: false, photoQualityFlagged: null, photoQualityNote: null },
    })

    // Brand-aware AI quality scan (own brand's logo is expected, not flagged).
    let flagged = false, scanReason = 'not scanned'
    try { const s = await scanPhotoUrl(product.id, photoUrl, product.brand); flagged = s.flagged; scanReason = s.reason } catch { /* leave unscanned */ }
    await prisma.product.update({
      where: { id: product.id },
      data:  { photoQualityNote: `Site search (${tier}, ${domain}) — ${scanReason}` },
    })

    return { ...base, tier, source: domain, imageUrl: cand.imageUrl, photoUrl, flagged, reason: scanReason }
  }

  return { ...base, tier: 'none', reason: `Found on ${domain} but image not downloadable (hotlink-blocked)` }
}
