/**
 * GET /api/cron/sync-stock
 * Nightly sync of QNE available stock quantities into products.qneAvailableQty.
 * Authenticated via CRON_SECRET (Vercel cron Authorization header).
 *
 * Requires the QNE host to be reachable (Radmin VPN on the runner / serverless
 * egress). Returns 503 with code QNE_UNAVAILABLE when it isn't.
 */

import { syncQneStock }            from '@/lib/qneStockSync'
import { QneUnavailableError }     from '@/lib/qneClient'
import { invalidateProductsCache } from '@/lib/products-api'

export async function GET(request: Request) {
  const auth     = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncQneStock()
    // Bust the product cache so the shop reflects the new stock gate immediately.
    invalidateProductsCache().catch(() => undefined)
    console.log(
      `Stock sync: ${result.productsUpdated} updated, ${result.zeroed} now zero, ${result.skipped} unmatched`,
    )
    return Response.json(result)
  } catch (err) {
    if (err instanceof QneUnavailableError) {
      return Response.json(
        { error: 'QNE unavailable — ensure Radmin VPN is active.', code: 'QNE_UNAVAILABLE' },
        { status: 503 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
