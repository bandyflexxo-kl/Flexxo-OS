/**
 * lib/redis.ts — Upstash Redis singleton
 *
 * Returns null when env vars are not configured — callers fall back gracefully
 * to Next.js unstable_cache (in-process, cleared on dev server restart).
 *
 * Setup:
 *   1. Create free database at https://console.upstash.com
 *      Region: ap-southeast-1 (Singapore — closest to Malaysia)
 *   2. Copy REST URL + REST Token → add to .env.local and Vercel env vars:
 *        UPSTASH_REDIS_REST_URL=https://...upstash.io
 *        UPSTASH_REDIS_REST_TOKEN=AX...
 */

import { Redis } from '@upstash/redis'

let _client: Redis | null = null

export function getRedis(): Redis | null {
  if (_client) return _client

  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    // Not configured — caller falls back to unstable_cache
    return null
  }

  _client = new Redis({ url, token })
  return _client
}
