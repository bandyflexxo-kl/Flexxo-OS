/**
 * lib/lotussSearch.ts — find Lotus's (lotuss.com.my) products for a query.
 *
 * Lotus's is a JS-rendered store with a private commerce API, so price/image
 * can't be scraped server-side. We instead use Serper (Google) to return the
 * real Lotus's product PAGES (name + link), plus a best-effort product image via
 * Serper Images. Price is entered by the salesperson.
 *
 * Search strategy (Jul 2026): the Google `site:` operator is unreliable through
 * Serper — it returns 0 results for many in-stock items (e.g. "coffee mate
 * creamer"). Using the bare domain `lotuss.com.my` as a KEYWORD and filtering
 * organic results to that domain is far more complete. We then rank the candidate
 * product pages by token-Jaccard similarity to the query (same mechanism as the
 * Smart Order matcher, lib/smartOrder.ts) and return the N most similar — so even
 * an item with no exact hit still surfaces its 3 closest Lotus's matches.
 *
 * URL fix (Jul 2026): Google/Serper still index the DEPRECATED `/product/{id}`
 * URL scheme, which now 404s ("Page not found") on lotuss.com.my. The live site
 * uses `/p/{slug}-{id}`, and `/p/{id}` (id only) auto-redirects to the canonical
 * slug. So we extract the numeric product id from Serper's stale link and rebuild
 * it as `https://www.lotuss.com.my/p/{id}` — verified to resolve in-browser.
 */

const SERPER_SEARCH = 'https://google.serper.dev/search'
const SERPER_IMAGES = 'https://google.serper.dev/images'
const SITE = 'lotuss.com.my'

export type LotussResult = {
  id:    string   // numeric Lotus's product id (used for dedup across pages)
  name:  string   // cleaned product name from the Lotus's page title
  link:  string   // canonical lotuss.com.my/p/{id} URL (resolves via redirect)
  image: string | null
}

function key(): string {
  return (process.env.SERPER_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '')
}

/**
 * Pull the Lotus's numeric product id out of a Serper link and return the
 * working product URL. Handles `/product/75134502`, `/product/slug-74700251`,
 * and `/p/slug-75149123` — the id is the last run of 6+ digits in the path.
 * Returns null when no id can be found (caller falls back to the raw link).
 */
function toProductUrl(link: string): string | null {
  const path = link.split(/[?#]/)[0]
  const runs = path.match(/\d{6,}/g)
  const id = runs?.[runs.length - 1]
  return id ? `https://www.${SITE}/p/${id}` : null
}

/** Strip the "| Lotus's Shop Online …" / " - Lotus's" suffixes from a page title. */
function cleanTitle(t: string): string {
  return t
    .replace(/\s*[|\-–]\s*Lotus['’]?s.*$/i, '')
    .replace(/\s*[|\-–]\s*Shop Online.*$/i, '')
    .trim()
}

async function serper(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'X-API-KEY': key(), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(20_000),
    })
    if (!r.ok) return null
    return await r.json() as Record<string, unknown>
  } catch { return null }
}

/** First relevant product image for a name (best-effort; null if none). */
async function imageFor(name: string): Promise<string | null> {
  const d = await serper(SERPER_IMAGES, { q: name, gl: 'my', num: 3 })
  const imgs = (d?.images ?? []) as { imageUrl?: string }[]
  return imgs.find(i => i.imageUrl?.startsWith('http'))?.imageUrl ?? null
}

// ── Token-Jaccard similarity (mirrors lib/smartOrder.ts) ──────────────────────
// Used to rank candidate Lotus's product pages against the search term so the
// N *most similar* items surface even when there's no exact-name hit.

const STOP_WORDS = new Set([
  'and', 'the', 'of', 'for', 'with', 'a', 'an', 'in', 'on', 'to', 'or',
  'gram', 'grams', 'gm', 'size', 'pack', 'new', 'lotuss', 'lotus', 'com', 'my',
])

/** Lightweight plural stemmer (creamers→creamer, boxes→box). */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.length > 4 && t.endsWith('es') && !t.endsWith('sses')) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  return t
}

/** lowercase → strip punctuation → split → drop stop/short tokens → stem; splits "450g"→"450","g". */
function tokenise(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue
    const dim = raw.match(/^(\d+(?:\.\d+)?)([a-z]{1,4})$/)   // "450g" → "450" + "g"
    if (dim && dim[1].length >= 2) { out.add(dim[1]); if (dim[2].length >= 2) out.add(dim[2]) }
    else out.add(stem(raw))
  }
  return out
}

/** Jaccard similarity of two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * One page of Lotus's products for a query, ranked by similarity to the query.
 *
 * The candidate pool per Google page is naturally small and NOT expandable by
 * `num` (num=15 and num=30 return the same set), so "Show more" works by paging:
 * the caller shows the returned pool 3-at-a-time, and requests the next Serper
 * `page` (passing the ids it already has via `exclude`) only when it runs out.
 *
 * We collect the unique Lotus's product pages on this page, drop any `exclude`d
 * ids (dedup across pages), rank by token-Jaccard similarity, and return the full
 * ranked pool (capped at `max`) — name + link reliable, image best-effort.
 * Returns [] when Serper surfaces no new Lotus's product page for the query/page.
 */
export async function searchLotuss(
  query: string,
  opts: { page?: number; exclude?: string[]; max?: number } = {},
): Promise<LotussResult[]> {
  if (!key()) return []
  const page    = opts.page ?? 1
  const exclude = new Set(opts.exclude ?? [])
  const max     = opts.max ?? 10

  const d = await serper(SERPER_SEARCH, { q: `${query} ${SITE}`, gl: 'my', num: 20, ...(page > 1 ? { page } : {}) })
  const organic = (d?.organic ?? []) as { title?: string; link?: string }[]

  // Collect unique Lotus's product candidates (dedupe by id, drop excluded ids).
  const seen = new Set<string>()
  const candidates: { id: string; name: string; link: string }[] = []
  for (const o of organic) {
    if (!o.link?.includes(SITE)) continue
    if (!(o.link.includes('/product/') || o.link.includes('/p/'))) continue
    const link = toProductUrl(o.link)
    if (!link) continue
    const id = link.split('/p/')[1]
    if (seen.has(id) || exclude.has(id)) continue
    seen.add(id)
    candidates.push({ id, name: cleanTitle(o.title ?? ''), link })
  }
  if (candidates.length === 0) return []

  // Rank by token-Jaccard similarity to the query → most similar first.
  const qTokens = tokenise(query)
  const ranked = candidates
    .map(c => ({ c, score: jaccard(qTokens, tokenise(c.name)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(r => r.c)

  return Promise.all(
    ranked.map(async c => ({ ...c, image: await imageFor(c.name || query) })),
  )
}
