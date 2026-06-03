import Anthropic from '@anthropic-ai/sdk'

export type ExtractedPriceRow = {
  code:        string
  description: string
  colour:      string | null
  packing:     string | null
  price:       number
  category:    string | null
}

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

export async function extractPricesFromPdf(pdfBuffer: Buffer): Promise<ExtractedPriceRow[]> {
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

  const text = message.content[0].type === 'text' ? message.content[0].text : ''

  // Extract JSON array from response (Claude sometimes wraps in markdown)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }

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
