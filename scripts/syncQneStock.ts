/**
 * syncQneStock.ts
 * Syncs QNE available stock quantities → products.qneAvailableQty.
 *
 * Run: npx tsx scripts/syncQneStock.ts
 * Requires: Radmin VPN connected to Flexxokl
 *
 * QNE READ-ONLY — only GET calls.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { syncQneStock }            = await import('@/lib/qneStockSync')
  const { invalidateProductsCache } = await import('@/lib/products-api')

  console.log('Syncing QNE available stock…')
  const result = await syncQneStock()

  console.log('─'.repeat(50))
  console.log('Stock balances fetched: ', result.stocksFetched)
  console.log('Products updated:       ', result.productsUpdated)
  console.log('  …of which now zero:   ', result.zeroed)
  console.log('Products unmatched:     ', result.skipped)
  if (result.errors.length) {
    console.log('Errors:')
    for (const e of result.errors) console.log('  • ' + e)
  }

  await invalidateProductsCache()
  console.log('Product cache invalidated.')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
