import { fetchProductsCached } from '@/lib/products-api'
import { getRedis }            from '@/lib/redis'

export const revalidate = false

export async function GET(_request: Request) {
  const t0    = Date.now()
  const redis = getRedis()

  // Probe Redis directly so we can report cache source in the response header
  let source = 'db'
  if (redis) {
    try {
      const hit = await redis.get<unknown[]>('flexxo:products:v1:retail')
      source = (hit && Array.isArray(hit) && hit.length > 0) ? 'redis' : 'redis-miss'
    } catch {
      source = 'redis-error'
    }
  } else {
    source = 'no-redis'
  }

  const products = await fetchProductsCached('retail')
  const ms       = Date.now() - t0

  return Response.json(products, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache':       source,
      'X-Cache-Ms':    String(ms),
    },
  })
}
