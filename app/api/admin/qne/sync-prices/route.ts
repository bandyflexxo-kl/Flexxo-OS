/**
 * POST /api/admin/qne/sync-prices
 * Syncs QNE last sale prices into products table.
 * Admin / Manager only. Requires Radmin VPN to be active.
 *
 * Returns: { ok, invoicesFetched, productsUpdated, skipped, errors[] }
 */

import { NextResponse }             from 'next/server'
import { verifySession }            from '@/lib/session'
import { syncQnePrices }            from '@/lib/qnePriceSync'
import { QneUnavailableError }      from '@/lib/qneClient'
import { invalidateProductsCache }  from '@/lib/products-api'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.role !== 'Admin' && session.role !== 'Manager') {
    return NextResponse.json({ error: 'Forbidden — Admin or Manager required' }, { status: 403 })
  }

  try {
    const result = await syncQnePrices(200)
    // Invalidate Redis product cache so clients see updated prices immediately
    // on their next page load (instead of waiting up to 24h for TTL expiry).
    // Fire-and-forget — sync result is not affected by cache invalidation.
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
