/**
 * POST /api/portal/search/photo
 *
 * Accepts: multipart/form-data with an 'image' file (JPEG / PNG / WebP / GIF)
 *
 * Uses Claude Vision to identify the product in the photo, then:
 *   1. Exact qneItemCode match → returns { matchId, query }
 *   2. No exact match        → returns { matchId: null, query } for fuzzy search
 *
 * Available to all shop visitors (guest and B2B).
 * Requires ANTHROPIC_API_KEY.
 */
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

// Vercel: allow long Claude calls. Default (~10s) kills the function mid-call,
// returning an empty body → client res.json() throws "Unexpected end of JSON input".
export const maxDuration = 60

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type AllowedMime  = typeof ALLOWED_MIME[number]

const client = new Anthropic()

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  let formData: FormData
  try { formData = await request.formData() }
  catch { return Response.json({ error: 'Could not parse form data' }, { status: 400 }) }

  const file = formData.get('image')
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing image field' }, { status: 400 })
  }
  if (!ALLOWED_MIME.includes(file.type as AllowedMime)) {
    return Response.json({ error: 'Unsupported image type' }, { status: 400 })
  }
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: 'Image too large (max 5 MB)' }, { status: 400 })
  }

  // Convert to base64 for Claude Vision
  const arrayBuf = await file.arrayBuffer()
  const base64   = Buffer.from(arrayBuf).toString('base64')

  const aiResult = await identifyProduct(base64, file.type as AllowedMime)

  if (!aiResult) {
    return Response.json({ matchId: null, query: '' })
  }

  // Try exact item-code match first
  if (aiResult.itemCode) {
    const exact = await prisma.product.findFirst({
      where:  { qneItemCode: aiResult.itemCode, isActive: true, isVisibleToCustomers: true },
      select: { id: true },
    })
    if (exact) return Response.json({ matchId: exact.id, query: aiResult.name })
  }

  // Return the name as a fuzzy-search query
  return Response.json({ matchId: null, query: aiResult.name })
}

async function identifyProduct(
  base64:   string,
  mimeType: AllowedMime,
): Promise<{ name: string; brand: string; itemCode: string } | null> {
  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens:  256,
      messages: [
        {
          role:    'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mimeType, data: base64 },
            },
            {
              type: 'text',
              text: `Look at this product image and identify what it is.
Return ONLY a JSON object with these fields:
{
  "name": "short product name (2-5 words, no brand prefix)",
  "brand": "brand name or empty string",
  "itemCode": "item code or SKU visible on label, or empty string"
}

Examples:
- A box of Pilot pens → {"name":"Ballpoint Pen Blue","brand":"Pilot","itemCode":"BPS-GP-M"}
- A ream of paper with no SKU → {"name":"A4 Copy Paper 80gsm","brand":"Double A","itemCode":""}
- Unknown product → {"name":"Office Product","brand":"","itemCode":""}

Return ONLY the JSON object, no explanation.`,
            },
          ],
        },
      ],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''
    // Strip markdown fences if present
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(json) as { name?: string; brand?: string; itemCode?: string }

    const name = [parsed.brand, parsed.name].filter(Boolean).join(' ').trim()
    return { name: name || 'product', brand: parsed.brand ?? '', itemCode: parsed.itemCode ?? '' }
  } catch {
    return null
  }
}
