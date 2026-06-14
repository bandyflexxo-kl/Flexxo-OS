import { getOptionalShopSession }  from '@/lib/session'
import { fetchProductsCached } from '@/lib/products-api'

/**
 * GET /api/portal/products
 *
 * Thin wrapper — pricing + caching handled by lib/products-api.ts (Redis-backed).
 * Reads session to determine tier (retail vs b2b); returns full catalogue with
 * browser cache headers.
 *
 * Note: q/categoryId filter params are not used here. The full catalogue is
 * cached and all filtering is applied client-side in ProductsClientPage for
 * instant-filter UX. This keeps the cache simple (one entry per tier).
 */
export async function GET(_request: Request) {
  const session = await getOptionalShopSession()
  const tier    = session?.role === 'B2B Client' ? 'b2b' : 'retail'

  // Do NOT set browser cache — Redis (24h) handles all caching.
  // This lets us bust the cache server-side instantly via invalidateProductsCache().
  return Response.json(await fetchProductsCached(tier), {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
