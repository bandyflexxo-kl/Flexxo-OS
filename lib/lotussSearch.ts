/**
 * lib/lotussSearch.ts — find Lotus's (lotuss.com.my) products for a query.
 *
 * Lotus's is a JS-rendered store with a private commerce API, so price/image
 * can't be scraped server-side. We instead use Serper (Google) to return the
 * real Lotus's product PAGES (name + link) via a site: search, plus a best-effort
 * product image via Serper Images. Price is entered by the salesperson.
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

/**
 * Top-N Lotus's products for a query (default 3). Name + link are reliable;
 * image is best-effort. Runs image lookups in parallel.
 */
export async function searchLotuss(query: string, count = 3): Promise<LotussResult[]> {
  if (!key()) return []
  const d = await serper(SERPER_SEARCH, { q: `${query} site:${SITE}`, gl: 'my', num: Math.max(count + 3, 8) })
  const organic = (d?.organic ?? []) as { title?: string; link?: string }[]

  const picks = organic
    .filter(o => o.link && (o.link.includes('/product/') || o.link.includes('/p/')))  // product pages only
    .slice(0, count)
    .map(o => ({ name: cleanTitle(o.title ?? ''), link: toProductUrl(o.link!) ?? o.link! }))

  const withImages = await Promise.all(
    picks.map(async p => ({ ...p, image: await imageFor(p.name || query) })),
  )
  return withImages
}
