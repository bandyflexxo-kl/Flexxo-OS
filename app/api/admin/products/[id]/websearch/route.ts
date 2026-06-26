import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { getBrandSite }  from '@/lib/brandSites'
import Anthropic         from '@anthropic-ai/sdk'
import { z }             from 'zod'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const BodySchema = z.object({
  site:     z.string().trim().optional(),
  hint:     z.string().trim().optional(),
  feedback: z.array(z.object({ title: z.string(), reason: z.string() })).optional(),
})

type SerperImage = { imageUrl: string; title: string }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey) return Response.json({ error: 'SERPER_API_KEY not configured' }, { status: 500 })

  const body   = await req.json().catch(() => ({})) as unknown
  const parsed = BodySchema.safeParse(body)
  const overrides = parsed.success ? parsed.data : {}

  const { id }  = await params
  const product = await prisma.product.findUnique({
    where:  { id },
    select: { name: true, brand: true, category: { select: { name: true } } },
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

  // Also pull DB hint if admin has saved one and no explicit hint given
  let dbHint: string | null = null
  if (!overrides.hint && product.brand) {
    const dbOverride = await prisma.brandSiteOverride.findUnique({
      where: { brand: product.brand.toUpperCase() },
    })
    dbHint = dbOverride?.hint ?? null
  }
  const hint = overrides.hint?.trim() || dbHint || null

  const siteContext = brandSite
    ? `The brand's official website is ${brandSite}. Generate a product-name search term (max 8 words, NO "site:" prefix — just the product keywords) that will find a clean product photo on that site.`
    : `Generate a Google Images search query (max 8 words) to find a CLEAN product photo (plain/white background, manufacturer or retailer source, no competitor logos, no custom printing overlay text).`

  const feedbackContext = overrides.feedback?.length
    ? `\n\nPrevious search returned bad results — do NOT repeat these types:\n${overrides.feedback.map(f => `- "${f.title}": ${f.reason}`).join('\n')}`
    : ''

  const hintContext = hint
    ? `\n\nAdmin hint: "${hint}" — incorporate this into the search keywords.`
    : ''

  const queryMsg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages:   [{
      role:    'user',
      content: `${siteContext}${hintContext}${feedbackContext}

Product:
  Name     : ${product.name}
  Brand    : ${product.brand ?? 'N/A'}
  Category : ${product.category.name}

Return ONLY the search keywords — no quotes, no explanation, no "site:" prefix.`,
    }],
  })

  const keywords = (queryMsg.content[0] as { type: 'text'; text: string }).text
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^site:\S+\s*/i, '')
    .slice(0, 120)

  const finalQuery = brandSite ? `site:${brandSite} ${keywords}` : keywords

  const res = await fetch('https://google.serper.dev/images', {
    method:  'POST',
    headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: finalQuery, gl: 'my', num: 10 }),
  })

  if (!res.ok) return Response.json({ error: `Serper error: ${res.status}` }, { status: 502 })

  const data       = await res.json() as { images?: SerperImage[] }
  const candidates = (data.images ?? [])
    .filter(img => img.imageUrl?.startsWith('http'))
    .slice(0, 5)
    .map(img => ({ imageUrl: img.imageUrl, title: img.title ?? '' }))

  return Response.json({ query: finalQuery, brandSite, candidates })
}
