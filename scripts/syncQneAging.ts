/**
 * syncQneAging.ts
 * Pulls QNE AgingSummary → companies.outstandingBalance / creditLimit / overdueAmount.
 *
 * Run: npx tsx scripts/syncQneAging.ts
 * Requires: Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { syncQneAging } = await import('@/lib/qneInvoiceSync')

  console.log('Syncing QNE aging summary → companies…')

  const result = await syncQneAging()

  console.log('─'.repeat(50))
  console.log('Aging records fetched:  ', result.recordsFetched)
  console.log('Companies updated:      ', result.companiesUpdated)
  if (result.errors.length) {
    console.log('\nErrors:')
    for (const e of result.errors) console.log('  • ' + e)
  }
  console.log(result.ok ? '\n✅ Done.' : '\n⚠️  Completed with errors.')
  process.exit(result.ok ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
