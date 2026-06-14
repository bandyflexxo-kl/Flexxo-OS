/**
 * POST /api/smart-order/scan-pdf
 * CRM-only endpoint (Salesperson / Manager / Admin).
 *
 * Body: { pdfBase64: string }
 *
 * Returns: { lines: MatchedLine[]; extractedText: string }
 *
 * Uses Claude (claude-sonnet-4-5) PDF document input to extract a product list
 * from an uploaded PDF, then runs the same parse + fuzzy-match as parse-text.
 * Requires ANTHROPIC_API_KEY to be set in env.
 */
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { verifySession } from '@/lib/session'
import { parseItemList, matchProductsForLines } from '@/lib/smartOrder'

const BodySchema = z.object({
  pdfBase64: z.string().min(1, 'pdfBase64 required'),
})

const PDF_PROMPT = `You are reading a customer purchase order or shopping list PDF.

Extract every product line item and return them as plain text, one item per line.

Each line should follow this format:
[qty] [unit] [product name]

Rules:
- If quantity is not visible, use 1
- If unit is not visible, omit it
- Include colour/size variants in the product name (e.g. "Faber Castel Gel Pen Blue")
- If the same product has multiple colours listed together (e.g. Blue / Red / Black),
  write each as a separate line
- Ignore headers, footers, page numbers, totals, terms, and company details
- Do NOT add any explanation, numbering, or commentary — only the list
- Do NOT add markdown, asterisks, or bullets

Example output:
2 box Faber Castel Gel Pen Blue
1 ream A4 Paper 80gsm
3 pcs Artline 90 Marker Black
1 Calculator`

export async function POST(request: Request) {
  // CRM session required
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'PDF scanning is not configured (ANTHROPIC_API_KEY missing). Use text paste instead.' },
      { status: 503 },
    )
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { pdfBase64 } = parsed.data

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Document block — double-cast: the SDK union includes DocumentBlockParam at
  // runtime but TS doesn't always narrow it (same pattern as lib/pdfExtract.ts).
  const documentBlock = {
    type:   'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
  } as unknown as Anthropic.Messages.ContentBlockParam

  const textBlock: Anthropic.Messages.ContentBlockParam = { type: 'text', text: PDF_PROMPT }

  let extractedText = ''
  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: [documentBlock, textBlock] }],
    })
    extractedText = message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''
  } catch (err) {
    console.error('[scan-pdf] Anthropic error:', err)
    return Response.json({ error: 'PDF scanning failed. Please try text paste instead.' }, { status: 502 })
  }

  if (!extractedText) {
    return Response.json({ error: 'Could not extract any items from the PDF.' }, { status: 422 })
  }

  const lines        = parseItemList(extractedText)
  const matchedLines = await matchProductsForLines(lines)

  return Response.json({ lines: matchedLines, extractedText })
}
