/**
 * QNE stock master data for the New Product modal.
 *  GET  → brands / categories / groups dropdown lists (read-only; needs VPN).
 *  POST → create a new brand|category|group in QNE (WRITE — Admin/Director only).
 *
 * Reuses QNE's native taxonomy; the shop category tree is a separate CRM concern.
 */

import { z } from 'zod'
import { verifySession } from '@/lib/session'
import {
  fetchStockMasters,
  createBrand,
  createCategory,
  createGroup,
} from '@/lib/qneStockMasters'
import { QneUnavailableError } from '@/lib/qneClient'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const masters = await fetchStockMasters()
    return Response.json(masters)
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN and retry.' }, { status: 503 })
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to load QNE masters' }, { status: 502 })
  }
}

const CreateMasterSchema = z.object({
  type: z.enum(['brand', 'category', 'group']),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(40, 'Code is too long')
    .regex(/^[A-Za-z0-9 ._/&-]+$/, 'Code contains unsupported symbols'),
  description: z.string().trim().max(120).optional(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = CreateMasterSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { type, code, description } = parsed.data
  try {
    if (type === 'brand') await createBrand(code, description ?? code)
    else if (type === 'category') await createCategory(code, description ?? code)
    else await createGroup(code, description ?? code)
    return Response.json({ ok: true, code })
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN and retry.' }, { status: 503 })
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to create master' }, { status: 502 })
  }
}
