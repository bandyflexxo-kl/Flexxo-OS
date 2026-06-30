import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { getBrandSite }  from '@/lib/brandSites'
import { z }             from 'zod'

// Vercel: Claude/Serper calls exceed the ~10s default → empty response → client JSON error.
export const maxDuration = 60

const JUNK_RE = /\b(with\s+printing|customize|customise|customization|customisation|printing|order\s+form|delivery\s+order|running\s+number|paper\s+colour|paper\s+color|colour|authorized|signature|2ply|3ply|4ply|bks|digits|2up|3up)\b/gi

const BodySchema = z.object({
  site:     z.string().trim().optional(),
  hint:     z.string().trim().optional(),
  feedback: z.array(z.object({ title: z.string(), reason: z.string() })).optional(),
})

type SerperImage = { imageUrl: string; title: string; imageWidth?: number; imageHeight?: number }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Whole handler is wrapped so ANY failure (Serper network error, parse error,
  // unexpected throw) returns a JSON error body — never an empty 500 that makes
  // the client's res.json() throw "Unexpected end of JSON input". The real error
  // message is surfaced so a misconfigured prod (e.g. missing key) is diagnosable.
  try {
    const session = await verifySession().catch(() => null)
    if (!session || !['Admin', 'Director'].includes(session.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const apiKey = process.env.SERPER_API_KEY
    if (!apiKey) return Response.json({ error: 'Image search is not configured on the server (SERPER_API_KEY missing).' }, { status: 500 })

    const body   = await req.json().catch(() => ({})) as unknown
    const parsed = BodySchema.safeParse(body)
    const overrides = parsed.success ? parsed.data : {}

    const { id }  = await params
    const product = await prisma.product.findUnique({
      where:  { id },
      select: { name: true, brand: true },
    })
    if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

    // Site priority: explicit override > DB brand override > brandSites.ts default
    let brandSite = overrides.site?.trim() || null
    if (!brandSite && product.brand) {
      const dbOverride = await prisma.brandSiteOverride.findUnique({
        where: { brand: product.brand.toUpperCase() },
      })
      brandSite = dbOverride?.site ?? getBrandSite(product.brand)
    }

    const stripped = product.name.replace(JUNK_RE, '').replace(/\s{2,}/g, ' ').trim()
    const core     = product.brand && !stripped.toLowerCase().includes(product.brand.toLowerCase())
      ? `${product.brand} ${stripped}`
      : stripped

    // Build query: hint overrides auto-name, feedback excluded titles appended as NOT
    let queryCore = overrides.hint?.trim() || `${core} product`
    if (overrides.feedback?.length) {
      const excludes = overrides.feedback
        .map(f => `-"${f.title.slice(0, 40)}"`)
        .join(' ')
      queryCore = `${queryCore} ${excludes}`
    }

    const query = brandSite
      ? `site:${brandSite} ${queryCore}`
      : `${queryCore} photo white background`

    let res: Response
    try {
      res = await fetch('https://google.serper.dev/images', {
        method:  'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: query, gl: 'my', num: 10 }),
        signal:  AbortSignal.timeout(20_000),
      })
    } catch {
      return Response.json({ error: 'The image search service did not respond — please try again.' }, { status: 504 })
    }

    if (!res.ok) return Response.json({ error: `Image search failed (Serper ${res.status}).` }, { status: 502 })

    const data       = await res.json() as { images?: SerperImage[] }
    const candidates = (data.images ?? [])
      .filter(img => img.imageUrl?.startsWith('http'))
      .slice(0, 5)
      .map(img => ({ imageUrl: img.imageUrl, title: img.title ?? '' }))

    return Response.json({ query, brandSite, candidates })
  } catch (e) {
    console.error('[rescrape] unhandled error:', e)
    return Response.json({ error: e instanceof Error ? e.message : 'Re-scrape failed.' }, { status: 500 })
  }
}
