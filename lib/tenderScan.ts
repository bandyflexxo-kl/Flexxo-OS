/**
 * lib/tenderScan.ts — AI extraction of tender line items from a client
 * document (PDF / image / pasted text) for Stage 1.
 *
 * Mirrors lib/pdfExtract.ts (Claude document/image blocks) but the schema is
 * tender-shaped: item name / unit / qty / target price, plus tender metadata
 * (submission deadline, validity period). Each item carries a confidence
 * score so the review UI can flag low-confidence rows yellow. Nothing is
 * persisted here — the Sales Executive confirms line-by-line.
 */
import Anthropic from '@anthropic-ai/sdk'

export type TenderScanItem = {
  name:        string
  unit:        string | null
  qty:         number | null
  targetPrice: number | null
  confidence:  number       // 0..1
}

export type TenderScanResult = {
  items:              TenderScanItem[]
  tenderName:         string | null
  submissionDeadline: string | null   // ISO date (YYYY-MM-DD) if found
  validityPeriod:     string | null
}

const MODEL = 'claude-sonnet-4-5'
const CLAUDE_PDF_LIMIT_BYTES = 30 * 1024 * 1024

const PROMPT = `You are extracting a TENDER / quotation request from a client document for an office-supply company in Malaysia.

Return ONLY a valid JSON object — no markdown, no code fences, no explanation.

Shape:
{
  "tenderName": string or null,                 // the tender/project title if stated
  "submissionDeadline": "YYYY-MM-DD" or null,   // submission/closing date if stated
  "validityPeriod": string or null,             // e.g. "90 days", "1 year contract"
  "items": [
    {
      "name": string,            // item description
      "unit": string or null,    // e.g. "PCS", "BOX", "REAM", "CTN"
      "qty": number or null,     // requested quantity as a number
      "targetPrice": number or null, // client's stated/target unit price if any
      "confidence": number       // 0.0–1.0 — how sure you are this row is a real line item
    }
  ]
}

Rules:
- Each distinct product line = one item. Skip section headers, totals, and notes.
- "qty" and "targetPrice" must be numbers (not strings) or null. Strip currency symbols/commas.
- Lower the confidence (<0.6) when the row is ambiguous, partially legible, or you inferred fields.
- If there are no line items, return "items": [].
- Always return a single JSON object starting with { and ending with }.`

function parseResult(text: string): TenderScanResult {
  const match = text.match(/\{[\s\S]*\}/)
  const empty: TenderScanResult = { items: [], tenderName: null, submissionDeadline: null, validityPeriod: null }
  if (!match) return empty
  let parsed: unknown
  try { parsed = JSON.parse(match[0]) } catch { return empty }
  if (typeof parsed !== 'object' || parsed === null) return empty
  const obj = parsed as Record<string, unknown>

  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items: TenderScanItem[] = rawItems
    .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
    .map(it => ({
      name:        typeof it.name === 'string' ? it.name.trim() : '',
      unit:        typeof it.unit === 'string' && it.unit.trim() !== '' ? it.unit.trim() : null,
      qty:         typeof it.qty === 'number' && Number.isFinite(it.qty) ? it.qty : null,
      targetPrice: typeof it.targetPrice === 'number' && Number.isFinite(it.targetPrice) ? it.targetPrice : null,
      confidence:  typeof it.confidence === 'number' ? Math.max(0, Math.min(1, it.confidence)) : 0.5,
    }))
    .filter(it => it.name !== '')

  return {
    items,
    tenderName:         typeof obj.tenderName === 'string' && obj.tenderName.trim() !== '' ? obj.tenderName.trim() : null,
    submissionDeadline: typeof obj.submissionDeadline === 'string' && obj.submissionDeadline.trim() !== '' ? obj.submissionDeadline.trim() : null,
    validityPeriod:     typeof obj.validityPeriod === 'string' && obj.validityPeriod.trim() !== '' ? obj.validityPeriod.trim() : null,
  }
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

async function runMessage(content: Anthropic.Messages.ContentBlockParam[]): Promise<TenderScanResult> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 8096,
    messages: [{ role: 'user', content }],
  })
  const responseText = message.content[0]?.type === 'text' ? message.content[0].text : ''
  return parseResult(responseText)
}

export async function scanTenderPdf(pdfBuffer: Buffer): Promise<TenderScanResult> {
  if (pdfBuffer.byteLength > CLAUDE_PDF_LIMIT_BYTES) {
    throw new Error('PDF is larger than 30 MB. Please split it or paste the item list as text.')
  }
  const documentBlock = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') },
  } as unknown as Anthropic.Messages.ContentBlockParam
  const textBlock: Anthropic.Messages.ContentBlockParam = { type: 'text', text: PROMPT }
  return runMessage([documentBlock, textBlock])
}

export async function scanTenderImage(imageBuffer: Buffer, mimeType: string): Promise<TenderScanResult> {
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
  type ImageMediaType = typeof validTypes[number]
  const mediaType: ImageMediaType = validTypes.includes(mimeType as ImageMediaType)
    ? (mimeType as ImageMediaType)
    : 'image/jpeg'
  return runMessage([
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') },
    } as Anthropic.Messages.ContentBlockParam,
    { type: 'text', text: PROMPT } as Anthropic.Messages.ContentBlockParam,
  ])
}

export async function scanTenderText(rawText: string): Promise<TenderScanResult> {
  const trimmed = rawText.slice(0, 100_000)
  return runMessage([{ type: 'text', text: `${PROMPT}\n\n--- DOCUMENT TEXT ---\n${trimmed}` }])
}
