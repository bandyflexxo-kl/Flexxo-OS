/**
 * POST /api/lotuss/pdf  { title?, markup?, rows:[{searchItem, image?, price}] }
 * Renders the price-match list to a PDF. The PDF shows the search-item name, the
 * product image, and price×markup — and deliberately NO Lotus's link.
 * Nothing is stored; the request body comes straight from the browser.
 */
import { verifySession } from '@/lib/session'
import { renderLotussPdf } from '@/lib/lotussPdf'
import { z } from 'zod'

export const maxDuration = 60

const Body = z.object({
  title:  z.string().trim().max(120).optional(),
  markup: z.number().min(0).max(10).optional(),
  rows: z.array(z.object({
    searchItem: z.string().max(200),
    image:      z.string().url().nullable().optional(),
    price:      z.number(),
  })).min(1).max(200),
})

/** Fetch a remote image → base64 data URI. Only JPEG/PNG (react-pdf can't do webp/gif). */
async function toDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (ct !== 'image/jpeg' && ct !== 'image/png') return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 3_000_000) return null
    return `data:${ct};base64,${buf.toString('base64')}`
  } catch { return null }
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { title, markup = 1.2, rows } = parsed.data

  const pdfRows = await Promise.all(rows.map(async r => ({
    name:      r.searchItem,
    imageData: r.image ? await toDataUri(r.image) : null,
    price:     r.price * markup,
  })))

  const buf = await renderLotussPdf({ title: title || 'Lotus Price Match', rows: pdfRows })
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': 'inline; filename="lotus-price-match.pdf"',
      'Cache-Control':       'private, no-store',
    },
  })
}
