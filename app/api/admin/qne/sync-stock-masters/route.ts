/**
 * POST /api/admin/qne/sync-stock-masters
 * Refreshes the qne_stock_masters DB cache (brands/categories/groups/uoms) from
 * live QNE so the New Product modal dropdowns stay current. Requires the Radmin
 * VPN (reads live QNE). Admin/Director only.
 */
import { verifySession } from '@/lib/session'
import { syncQneStockMasters } from '@/lib/qneStockMasters'
import { QneUnavailableError } from '@/lib/qneClient'

export const maxDuration = 60

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await syncQneStockMasters()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN and retry.' }, { status: 503 })
    return Response.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 502 })
  }
}
