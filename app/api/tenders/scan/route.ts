/**
 * POST /api/tenders/scan
 * Stage-1 AI extraction. CRM tender roles only (anyone who may create a tender).
 *
 * Body (one of):
 *   { kind: 'pdf',   data: base64 }
 *   { kind: 'image', data: base64, mimeType: 'image/png' }
 *   { kind: 'text',  data: 'pasted text' }
 *
 * Returns TenderScanResult — NOT persisted. The executive confirms items
 * before they are saved via POST /api/tenders.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { canCreateTender } from '@/lib/tenderAccess'
import { scanTenderPdf, scanTenderImage, scanTenderText } from '@/lib/tenderScan'

const BodySchema = z.object({
  kind:     z.enum(['pdf', 'image', 'text']),
  data:     z.string().min(1, 'data required'),
  mimeType: z.string().optional(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateTender(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'AI scanning is not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 })
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { kind, data, mimeType } = parsed.data
  try {
    const result =
      kind === 'pdf'   ? await scanTenderPdf(Buffer.from(data, 'base64')) :
      kind === 'image' ? await scanTenderImage(Buffer.from(data, 'base64'), mimeType ?? 'image/jpeg') :
                         await scanTenderText(data)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scan failed'
    return Response.json({ error: msg }, { status: 400 })
  }
}
