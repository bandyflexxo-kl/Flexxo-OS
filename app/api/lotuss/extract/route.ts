/**
 * POST /api/lotuss/extract  { text? | image?{data,mimeType} | pdf?(base64) }
 * Extracts a clean list of searchable product names from a pasted list, an
 * uploaded photo, or a PDF (Claude). Returns { items: string[] }.
 */
import { verifySession } from '@/lib/session'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

export const maxDuration = 60

const Body = z.object({
  text:  z.string().trim().max(20_000).optional(),
  image: z.object({
    data:     z.string(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  }).optional(),
  pdf:   z.string().optional(),   // base64
})

const PROMPT =
  'You are given a pantry / grocery / office-supply shopping list (as text, an image, or a PDF). ' +
  'Extract EVERY distinct item as a short, searchable product name. Drop quantities, prices, ' +
  'bullet numbers, section headers, and notes — keep just the product name (brand + item). ' +
  'Return ONLY a JSON array of strings, e.g. ["Milo 3in1","Nescafe Gold","A4 paper 80gsm"]. No prose.'

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'AI is not configured (ANTHROPIC_API_KEY missing).' }, { status: 500 })

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { text, image, pdf } = parsed.data
  if (!text && !image && !pdf) return Response.json({ error: 'Provide text, an image, or a PDF.' }, { status: 400 })

  const content: Anthropic.ContentBlockParam[] = []
  if (image) content.push({ type: 'image',    source: { type: 'base64', media_type: image.mimeType, data: image.data } })
  if (pdf)   content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } })
  content.push({ type: 'text', text: `${PROMPT}${text ? `\n\nList:\n${text}` : ''}` })

  try {
    const client = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY ?? '').replace(/[^\x20-\x7E]/g, '') })
    const msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 2000, messages: [{ role: 'user', content }] })
    const raw = (msg.content[0] as { type: 'text'; text: string }).text.trim()
    const jsonStr = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

    let items: string[] = []
    try {
      const p = JSON.parse(jsonStr)
      if (Array.isArray(p)) items = p.filter(x => typeof x === 'string').map(s => (s as string).trim()).filter(Boolean)
    } catch { /* leave empty */ }
    items = [...new Set(items)].slice(0, 100)

    if (items.length === 0) return Response.json({ error: 'No items could be read. Try clearer text/image.' }, { status: 422 })
    return Response.json({ items })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Extraction failed' }, { status: 502 })
  }
}
