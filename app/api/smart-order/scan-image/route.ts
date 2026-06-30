/**
 * POST /api/smart-order/scan-image
 * CRM-only endpoint (Salesperson / Manager / Admin).
 *
 * Body: { imageBase64: string; mimeType: string }
 *   mimeType: one of image/jpeg, image/png, image/gif, image/webp
 *
 * Returns: { lines: MatchedLine[]; extractedText: string }
 *
 * Uses Claude Vision (claude-sonnet-4-5) to extract a product list from
 * an uploaded photo, then runs the same parse + fuzzy-match as parse-text.
 * Requires ANTHROPIC_API_KEY to be set in env.
 */
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { verifySession } from '@/lib/session'
import { parseItemList, matchProductsForLines, type DeliveryInfo } from '@/lib/smartOrder'

// Vercel: allow long Claude calls. Default (~10s) kills the function mid-call,
// returning an empty body → client res.json() throws "Unexpected end of JSON input".
export const maxDuration = 60

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type AllowedMime   = typeof ALLOWED_MIME[number]

const BodySchema = z.object({
  imageBase64: z.string().min(1, 'imageBase64 required'),
  mimeType:    z.enum(ALLOWED_MIME).refine(v => ALLOWED_MIME.includes(v as typeof ALLOWED_MIME[number]), {
    message: 'mimeType must be image/jpeg, image/png, image/gif, or image/webp',
  }),
  companyId:   z.string().uuid().optional(),
})

const IMAGE_PROMPT = `You are reading a customer purchase order or shopping list image.

First, list every product line item — one per line in the format: [qty] [unit] [product name]

Rules for items:
- If quantity is not visible, use 1
- If unit is not visible, omit it
- Include colour/size variants in the product name (e.g. "Faber Castel Gel Pen Blue")
- If the same product has multiple colours listed together, write each as a separate line
- Do NOT add any explanation, numbering, or commentary — only the list
- Do NOT add markdown, asterisks, or bullets

Then, if delivery information is visible (recipient name, phone, delivery address), append it at the very end after a line containing only "---", as a single JSON object:
{"recipient":"name or empty string","phone":"number or empty string","address":"full delivery address or empty string"}

If no delivery info is visible, omit the --- line entirely.

Example output WITH delivery:
2 box Faber Castel Gel Pen Blue
1 ream A4 Paper 80gsm
---
{"recipient":"Ahmad Razif","phone":"0123456789","address":"Lot 5, Jalan ABC, 47500 Subang Jaya, Selangor"}

Example output WITHOUT delivery:
2 box Faber Castel Gel Pen Blue
1 ream A4 Paper 80gsm`

export async function POST(request: Request) {
  // CRM session required
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Photo scanning is not configured (ANTHROPIC_API_KEY missing). Use text paste instead.' },
      { status: 503 },
    )
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { imageBase64, mimeType } = parsed.data

  // Call Claude Vision
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let extractedText = ''
  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type:   'image',
              source: {
                type:       'base64',
                media_type: mimeType as AllowedMime,
                data:       imageBase64,
              },
            } as unknown as Anthropic.Messages.ContentBlockParam,
            {
              type: 'text',
              text: IMAGE_PROMPT,
            } as Anthropic.Messages.ContentBlockParam,
          ],
        },
      ],
    })
    extractedText = message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''
  } catch (err) {
    console.error('[scan-image] Anthropic error:', err)
    return Response.json({ error: 'Image scanning failed. Please try text paste instead.' }, { status: 502 })
  }

  if (!extractedText) {
    return Response.json({ error: 'Could not extract any items from the image.' }, { status: 422 })
  }

  // Split out delivery JSON block if Claude appended it
  let itemsText = extractedText
  const deliveryInfo: DeliveryInfo = { address: null, recipient: null, phone: null }
  const sepIdx = extractedText.lastIndexOf('\n---\n')
  if (sepIdx >= 0) {
    itemsText = extractedText.slice(0, sepIdx).trim()
    try {
      const d = JSON.parse(extractedText.slice(sepIdx + 5).trim()) as Record<string, string>
      deliveryInfo.recipient = d.recipient?.trim() || null
      deliveryInfo.phone     = d.phone?.trim()     || null
      deliveryInfo.address   = d.address?.trim()   || null
    } catch { /* ignore malformed JSON */ }
  }

  const lines        = parseItemList(itemsText)
  const matchedLines = await matchProductsForLines(lines, parsed.data.companyId)

  return Response.json({ lines: matchedLines, extractedText: itemsText, deliveryInfo })
}
