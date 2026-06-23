/**
 * POST /api/smart-order/parse-text
 * CRM-only endpoint (Salesperson / Manager / Admin).
 *
 * Body: { text: string }
 * Returns: { lines: MatchedLine[] }
 *
 * Parses a pasted plain-text item list and fuzzy-matches each line
 * against the product catalogue. No AI required.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { parseItemList, matchProductsForLines, extractDeliveryInfo } from '@/lib/smartOrder'

const BodySchema = z.object({
  text:      z.string().min(1, 'text is required').max(20_000, 'text too long'),
  companyId: z.string().uuid().optional(),
})

export async function POST(request: Request) {
  // CRM session required — B2B clients cannot use this endpoint
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const deliveryInfo = extractDeliveryInfo(parsed.data.text)
  const lines        = parseItemList(parsed.data.text)
  const matchedLines = await matchProductsForLines(lines, parsed.data.companyId)

  return Response.json({ lines: matchedLines, deliveryInfo })
}
