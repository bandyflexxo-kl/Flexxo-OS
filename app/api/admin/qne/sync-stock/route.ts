/**
 * POST /api/admin/qne/sync-stock
 * Syncs QNE available stock quantities into products.qneAvailableQty.
 * Admin / Manager / Director only. Requires Radmin VPN to be active.
 *
 * Returns: { ok, stocksFetched, productsUpdated, zeroed, skipped, errors[] }
 */

import { NextResponse }            from 'next/server'
import { verifySession }           from '@/lib/session'
import { syncQneStock }            from '@/lib/qneStockSync'
import { QneUnavailableError }     from '@/lib/qneClient'
import { invalidateProductsCache } from '@/lib/products-api'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!['Admin', 'Director', 'Manager'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden — Admin or Manager required' }, { status: 403 })
  }

  try {
    const result = await syncQneStock()
    invalidateProductsCache().catch(() => undefined)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return NextResponse.json(
        { error: 'QNE unavailable — ensure Radmin VPN is active.', code: 'QNE_UNAVAILABLE' },
        { status: 503 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
