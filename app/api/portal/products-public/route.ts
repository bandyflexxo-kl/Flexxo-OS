import { fetchProductsCached } from '@/lib/products-api'

/**
 * GET /api/portal/products-public
 *
 * Public product listing — retail prices only, NO session required.
 * No Next.js dynamic APIs used → Vercel edge CDN can ISR-cache each URL.
 *
 * Pricing + caching handled by lib/products-api.ts (Redis-backed, 24h TTL).
 */

// Tell Vercel edge CDN: ISR-cache for 24 hours
export const revalidate = 86400

export async function GET(_request: Request) {
  // Cache-Control:
  //   public               — browser + CDN both cache
  //   max-age=86400        — 24 h browser cache; reload = instant disk cache hit
  //   s-maxage=86400       — 24 h CDN cache
  //   stale-while-revalidate=3600 — serve stale immediately while refreshing
  return Response.json(await fetchProductsCached('retail'), {
    headers: {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
    },
  })
}
