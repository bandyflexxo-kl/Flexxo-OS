import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SCAN_PROMPT = `Inspect this product photo. Flag it if it contains ANY of:
1. A competitor company logo, brand name, or trademark (e.g. "THYE HIN", "Office Plus", "TP" rainbow logo)
2. Overlay text advertising a printing/customization service (e.g. "Customize Printing", "2ply 3ply 4ply", "Up to 7 Digits Running Number", "Paper Colour")
3. Website URLs or contact details from another business
4. Obvious watermark text from another shop or supplier

Respond with JSON only — no markdown, no explanation outside the JSON:
{"flagged": true|false, "reason": "one short sentence"}`

export async function scanProductPhoto(
  productId: string
): Promise<{ flagged: boolean; reason: string }> {
  const product = await prisma.product.findUnique({
    where:  { id: productId },
    select: { photoUrl: true },
  })
  if (!product?.photoUrl) throw new Error('No photo URL')

  return scanPhotoUrl(productId, product.photoUrl)
}

export async function scanPhotoUrl(
  productId: string,
  photoUrl:  string
): Promise<{ flagged: boolean; reason: string }> {
  const imgRes = await fetch(photoUrl, { signal: AbortSignal.timeout(15_000) })
  if (!imgRes.ok) throw new Error(`Photo download failed: ${imgRes.status}`)

  const buf      = Buffer.from(await imgRes.arrayBuffer())
  const rawMime  = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const mimeType = rawMime.split(';')[0].trim() as
    'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: buf.toString('base64') } },
        { type: 'text',  text: SCAN_PROMPT },
      ],
    }],
  })

  const raw    = (msg.content[0] as { type: 'text'; text: string }).text.trim()
  let flagged  = false
  let reason   = 'Scan complete'

  try {
    const clean  = raw.replace(/^```(?:json)?|```$/gm, '').trim()
    const parsed = JSON.parse(clean) as { flagged: boolean; reason: string }
    flagged = parsed.flagged
    reason  = parsed.reason
  } catch {
    flagged = /\"flagged\"\s*:\s*true/i.test(raw)
    reason  = raw.slice(0, 120)
  }

  await prisma.product.update({
    where: { id: productId },
    data:  { photoQualityFlagged: flagged, photoQualityNote: reason },
  })

  return { flagged, reason }
}
