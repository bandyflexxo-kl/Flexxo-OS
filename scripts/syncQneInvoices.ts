/**
 * syncQneInvoices.ts
 * Pulls QNE SalesInvoices (last 2 years) + line items into Supabase.
 *
 * Run: npx tsx scripts/syncQneInvoices.ts
 * Optional: npx tsx scripts/syncQneInvoices.ts --from 2024-01-01
 * Requires: Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const fromArg = process.argv.find(a => a.startsWith('--from'))
  const fromDate = fromArg ? fromArg.split('=')[1] ?? process.argv[process.argv.indexOf(fromArg) + 1] : undefined

  const { syncQneInvoices } = await import('@/lib/qneInvoiceSync')

  console.log(`Syncing QNE invoices${fromDate ? ` from ${fromDate}` : ' (last 2 years)'}…`)
  console.log('This may take a few minutes depending on invoice volume.\n')

  const result = await syncQneInvoices(fromDate)

  console.log('─'.repeat(50))
  console.log('Invoices fetched:   ', result.invoicesFetched)
  console.log('Invoices upserted:  ', result.invoicesUpserted)
  console.log('Line items upserted:', result.itemsUpserted)
  console.log('Companies linked:   ', result.companiesLinked)
  if (result.errors.length) {
    console.log('\nErrors:')
    for (const e of result.errors) console.log('  • ' + e)
  }
  console.log(result.ok ? '\n✅ Done.' : '\n⚠️  Completed with errors.')
  process.exit(result.ok ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
