import { fetchProductsCached } from '@/lib/products-api'

export const revalidate = false

export async function GET(_request: Request) {
  return Response.json(await fetchProductsCached('retail'), {
    headers: {
      // Allow CDN + browser to cache the guest catalogue for 24 h.
      // The Upstash Redis layer (server-side) already serves this fast; the
      // HTTP cache means repeat visitors never hit the Vercel function at all.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
