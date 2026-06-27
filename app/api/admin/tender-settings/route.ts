/**
 * GET  /api/admin/tender-settings — current tender settings.
 * POST /api/admin/tender-settings — update them (SuperAdmin / Admin only).
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { canEditTenderSettings } from '@/lib/tenderAccess'
import { getTenderSettings, setTenderSetting, TENDER_KEYS } from '@/lib/tenderSettings'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditTenderSettings(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  return Response.json(await getTenderSettings())
}

const BodySchema = z.object({
  varianceThreshold: z.number().min(0).max(100),
  minQuotesDefault:  z.number().int().positive().nullable(),
  qneWritesEnabled:  z.boolean(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditTenderSettings(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  await setTenderSetting(TENDER_KEYS.varianceThreshold, String(d.varianceThreshold))
  await setTenderSetting(TENDER_KEYS.minQuotesDefault, d.minQuotesDefault != null ? String(d.minQuotesDefault) : '')
  await setTenderSetting(TENDER_KEYS.qneWritesEnabled, d.qneWritesEnabled ? 'true' : 'false')

  return Response.json({ ok: true })
}
