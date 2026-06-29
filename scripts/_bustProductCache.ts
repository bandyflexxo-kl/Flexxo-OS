/** Bust the shop catalogue Redis cache so barcodes appear immediately. npx tsx scripts/_bustProductCache.ts */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { getRedis } = await import('../lib/redis')
  const redis = getRedis()
  if (!redis) {
    console.log('Redis not configured (UPSTASH_* unset) — nothing to bust. The unstable_cache fallback clears on next server restart / 24h TTL.')
    return
  }
  await Promise.all([
    redis.del('flexxo:products:v1:retail'),
    redis.del('flexxo:products:v1:b2b'),
  ])
  console.log('✓ Busted flexxo:products:v1:{retail,b2b} — shop rebuilds the catalogue (with barcodes) on next request.')
}
main().catch(e => { console.error(e.message); process.exit(1) })
