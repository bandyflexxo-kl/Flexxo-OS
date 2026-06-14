import { fetchProductsCached } from '@/lib/products-api'

/**
 * GET /api/portal/products-public
 *
 * Public product listing — retail prices only, NO session required.
 * No Next.js dynamic APIs used → Vercel edge CDN can ISR-cache each URL.
 *
 * Pricing + caching handled by lib/products-api.ts (Redis-backed, 24h TTL).
 */

// Do NOT set browser or CDN cache — Redis (24h) handles all caching.
// This lets us bust the cache server-side instantly via invalidateProductsCache().
export const revalidate = false

export async function GET(_request: Request) {
  return Response.json(await fetchProductsCached('retail'), {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
