import { verifySession }             from '@/lib/session'
import { prisma }                    from '@/lib/prisma'
import { z }                         from 'zod'
import { invalidateProductsCache }   from '@/lib/products-api'
import { invalidateSmartOrderCache } from '@/lib/smartOrder'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const settings = await prisma.systemSetting.findMany()
  const map = Object.fromEntries(settings.map(s => [s.key, s.value]))
  return Response.json(map)
}

const marginRegex = /^\d+(\.\d{1,2})?$/
const Schema = z.object({
  default_margin_pct:            z.string().regex(marginRegex, 'Must be a number e.g. 30 or 25.5').optional(),
  retail_margin_pct:             z.string().regex(marginRegex, 'Must be a number e.g. 30 or 25.5').optional(),
  b2b_margin_pct:                z.string().regex(marginRegex, 'Must be a number e.g. 20 or 22.5').optional(),
  tier_margin_low_pct:           z.string().regex(marginRegex, 'Must be a number e.g. 30').optional(),
  tier_margin_mid_pct:           z.string().regex(marginRegex, 'Must be a number e.g. 25').optional(),
  tier_margin_high_pct:          z.string().regex(marginRegex, 'Must be a number e.g. 20').optional(),
  google_drive_photos_folder_id: z.string().optional(),
})

const TIER_KEYS = new Set(['tier_margin_low_pct', 'tier_margin_mid_pct', 'tier_margin_high_pct'])

export async function PATCH(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const updates = parsed.data
  let tierChanged = false
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      await prisma.systemSetting.upsert({
        where:  { key },
        update: { value },
        create: { key, value },
      })
      if (TIER_KEYS.has(key)) tierChanged = true
    }
  }

  if (tierChanged) {
    await Promise.all([
      invalidateProductsCache(),
      invalidateSmartOrderCache(),
    ])
  }

  return Response.json({ ok: true })
}
