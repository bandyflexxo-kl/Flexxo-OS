/**
 * Preview the next auto-generated stock code for a brand (SOP: codes are
 * system-generated, never typed). GET /api/admin/products/next-code?brand=APLUS
 * The authoritative code is re-generated server-side on create — this is UX only.
 */

import { verifySession } from '@/lib/session'
import { nextStockCode } from '@/lib/stockCodeGen'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const brand = new URL(request.url).searchParams.get('brand')?.trim() ?? ''
  if (!brand) return Response.json({ code: '' })

  const code = await nextStockCode(brand)
  return Response.json({ code })
}
