import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const product = await prisma.product.findUnique({
    where:  { id },
    select: { id: true, photoUrl: true, photoApprovedByAdmin: true },
  })

  if (!product?.photoUrl) {
    return Response.json({ error: 'No scraped photo' }, { status: 400 })
  }

  if (product.photoApprovedByAdmin) {
    return Response.json({ flagged: false, reason: 'Permanently approved by admin — scan skipped', skipped: true })
  }

  const imgRes = await fetch(product.photoUrl)
  if (!imgRes.ok) return Response.json({ error: 'Could not download photo' }, { status: 500 })

  const buf      = Buffer.from(await imgRes.arrayBuffer())
  const base64   = buf.toString('base64')
  const rawMime  = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const mimeType = rawMime.split(';')[0].trim() as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{
      role:    'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: mimeType, data: base64 },
        },
        {
          type: 'text',
          text: `Inspect this product photo. Flag it if it contains ANY of:
1. A competitor company logo, brand name, or trademark (e.g. "THYE HIN", "Office Plus", "TP" rainbow logo)
2. Overlay text advertising a printing/customization service (e.g. "Customize Printing", "2ply 3ply 4ply", "Up to 7 Digits Running Number", "Paper Colour")
3. Website URLs or contact details from another business
4. Obvious watermark text from another shop or supplier

Respond with JSON only — no markdown, no explanation outside the JSON:
{"flagged": true|false, "reason": "one short sentence"}`,
        },
      ],
    }],
  })

  const raw = (msg.content[0] as { type: 'text'; text: string }).text.trim()
  let flagged = false
  let reason  = 'Scan complete'

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
    where: { id },
    data:  { photoQualityFlagged: flagged, photoQualityNote: reason },
  })

  return Response.json({ flagged, reason })
}
