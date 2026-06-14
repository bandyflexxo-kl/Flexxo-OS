import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { invalidateProductsCache } = await import('@/lib/products-api')
  await invalidateProductsCache()
  console.log('Redis product cache invalidated for both retail + b2b tiers')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
