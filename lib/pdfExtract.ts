import Anthropic from '@anthropic-ai/sdk'

// pdfjs-dist 4.x (used by pdf-parse 2.x) accesses DOMMatrix / ImageData / Path2D
// during module initialisation — these are browser globals absent in Node.js.
// Stub them before the require so the module loads without crashing.
// next.config.ts lists pdf-parse in serverExternalPackages so the bundler never
// touches it; Node.js resolves the CJS entry (dist/pdf-parse/cjs/index.cjs) natively.
const g = globalThis as Record<string, unknown>
if (!g['DOMMatrix'])  g['DOMMatrix']  = class DOMMatrix  { isIdentity = true }
if (!g['ImageData'])  g['ImageData']  = class ImageData  { constructor(public width=0, public height=0){} }
if (!g['Path2D'])     g['Path2D']     = class Path2D     {}
// pdf-parse v2 exports a class, not a function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> } }

export type ExtractedPriceRow = {
  code:        string
  description: string
  colour:      string | null
  packing:     string | null
  price:       number
  category:    string | null
}

// 30 MB — files above this are too large for Claude's document block
const CLAUDE_PDF_LIMIT_BYTES = 30 * 1024 * 1024

const PROMPT = `You are extracting product pricing data from a supplier price list PDF.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences.

Each object must have these exact fields:
- "code": product code or SKU string (empty string "" if none)
- "description": full product description string
- "colour": colour information string, or null if not present
- "packing": packing / unit size string (e.g. "12/144/1728", "40 PCS / DRUM"), or null
- "price": the retail / selling price as a positive number (not a string)
- "category": the section header this product belongs to (e.g. "M&G BALL POINT PEN"), or null

Rules:
- Skip rows that are section/category headers (all caps, no price)
- Skip completely empty rows
- Price must be a positive number — skip rows with no valid price
- Return the array starting with [ and ending with ]`

function parseRows(text: string): ExtractedPriceRow[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  let parsed: unknown
  try { parsed = JSON.parse(match[0]) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is ExtractedPriceRow => {
    if (typeof item !== 'object' || item === null) return false
    const row = item as Record<string, unknown>
    return (
      typeof row.description === 'string' &&
      row.description.trim() !== ''       &&
      typeof row.price === 'number'       &&
      row.price > 0
    )
  })
}

export async function extractPricesFromPdf(pdfBuffer: Buffer): Promise<ExtractedPriceRow[]> {
  if (pdfBuffer.byteLength > CLAUDE_PDF_LIMIT_BYTES) {
    const { text } = await new PDFParse({ data: pdfBuffer }).getText()
    return extractPricesFromText(text)
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const base64 = pdfBuffer.toString('base64')

  // Build the document block — double-cast needed because the SDK's
  // ContentBlockParam union includes DocumentBlockParam at runtime but
  // TypeScript inference doesn't always narrow it correctly.
  const documentBlock = {
    type:   'document',
    source: {
      type:       'base64',
      media_type: 'application/pdf',
      data:       base64,
    },
  } as unknown as Anthropic.Messages.ContentBlockParam

  const textBlock: Anthropic.Messages.ContentBlockParam = {
    type: 'text',
    text: PROMPT,
  }

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 8096,
    messages: [
      { role: 'user', content: [documentBlock, textBlock] },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  return parseRows(responseText)
}

export async function extractPricesFromImage(imageBuffer: Buffer, mimeType: string): Promise<ExtractedPriceRow[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const base64 = imageBuffer.toString('base64')

  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
  type ImageMediaType = typeof validTypes[number]
  const mediaType: ImageMediaType = validTypes.includes(mimeType as ImageMediaType)
    ? (mimeType as ImageMediaType)
    : 'image/jpeg'

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 8096,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        } as Anthropic.Messages.ContentBlockParam,
        { type: 'text', text: PROMPT } as Anthropic.Messages.ContentBlockParam,
      ],
    }],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  return parseRows(responseText)
}

export async function extractPricesFromText(rawText: string): Promise<ExtractedPriceRow[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const truncated = rawText.length > 100_000 ? rawText.slice(0, 100_000) + '\n[TRUNCATED]' : rawText

  const message = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 8096,
    messages: [{
      role: 'user',
      content: `${PROMPT}\n\nSupplier price list text:\n\n${truncated}`,
    }],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  return parseRows(responseText)
}
