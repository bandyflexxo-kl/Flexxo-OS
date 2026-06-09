import { getOptionalSession }  from '@/lib/session'
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
  const session = await getOptionalSession()
  const tier    = session?.role === 'B2B Client' ? 'b2b' : 'retail'

  // Cache-Control:
  //   private              — browser caches; CDN cannot (session pricing)
  //   max-age=86400        — 24 h browser cache; reload = instant disk cache hit
  //   stale-while-revalidate=3600 — after 24 h, serve stale immediately while
  //                                  fetching fresh in background (no spinner)
  return Response.json(await fetchProductsCached(tier), {
    headers: {
      'Cache-Control': 'private, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
