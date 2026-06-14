/**
 * GET /api/debug/redis
 * Temporary endpoint — test Redis connectivity from Vercel.
 * DELETE THIS FILE after diagnosis is complete.
 */
import { getRedis } from '@/lib/redis'

export async function GET() {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return Response.json({
      status: 'no_env_vars',
      url:    url   ? `${url.slice(0, 30)}...` : null,
      token:  token ? `${token.slice(0, 10)}...` : null,
    })
  }

  const redis = getRedis()
  if (!redis) {
    return Response.json({ status: 'client_null', url: url.slice(0, 30), token: token.slice(0, 10) })
  }

  try {
    const start    = Date.now()
    await redis.set('flexxo:debug:ping', 'pong', { ex: 60 })
    const val      = await redis.get('flexxo:debug:ping')
    const latencyMs = Date.now() - start

    const cachedCount = await redis.get<unknown[]>('flexxo:products:v1:retail')
      .then(r => (Array.isArray(r) ? r.length : 0))
      .catch(() => -1)

    return Response.json({
      status:      'ok',
      ping:        val,
      latencyMs,
      cachedCount,
      url:         `${url.slice(0, 30)}...`,
      token:       `${token.slice(0, 10)}...`,
    })
  } catch (err) {
    return Response.json({
      status: 'error',
      error:  err instanceof Error ? err.message : String(err),
      url:    url.slice(0, 30),
      token:  token.slice(0, 10),
    })
  }
}
