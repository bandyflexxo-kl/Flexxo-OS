/**
 * syncQneQuotations.ts
 * Pulls QNE Quotations + line items → qne_quotations table.
 *
 * Run: npx tsx scripts/syncQneQuotations.ts
 * Optional: npx tsx scripts/syncQneQuotations.ts --from 2025-01-01
 * Requires: Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const fromArg  = process.argv.find(a => a.startsWith('--from'))
  const fromDate = fromArg
    ? (fromArg.split('=')[1] ?? process.argv[process.argv.indexOf(fromArg) + 1])
    : undefined

  const { syncQneQuotations } = await import('@/lib/qneQuotationSync')

  console.log(`Syncing QNE quotations${fromDate ? ` from ${fromDate}` : ' (last 2 years)'}…`)
  console.log('Requires Radmin VPN connected to Flexxokl.\n')

  const result = await syncQneQuotations(fromDate)

  console.log('─'.repeat(50))
  console.log('Quotations fetched:   ', result.quotationsFetched)
  console.log('Quotations upserted:  ', result.quotationsUpserted)
  console.log('Line items upserted:  ', result.itemsUpserted)
  console.log('Companies linked:     ', result.companiesLinked)
  if (result.errors.length) {
    console.log('\nErrors:')
    for (const e of result.errors) console.log('  • ' + e)
  }
  console.log(result.ok ? '\n✅ Done.' : '\n⚠️  Completed with errors.')
  process.exit(result.ok ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
