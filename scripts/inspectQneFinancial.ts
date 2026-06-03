/**
 * Inspect raw QNE financial API responses to find the correct field names + endpoints.
 * Run: npx tsx scripts/inspectQneFinancial.ts
 * Requires Radmin VPN connected to Flexxokl network.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { qneLogin, qneGet, QNE_API_URL, QNE_DB_CODE } = await import('../lib/qneClient')

  console.log('Logging into QNE...')
  const token = await qneLogin()
  console.log('✓ Logged in\n')

  // ── 1. Get first few customers to find a real code + ID ───────────────────
  console.log('=== GET /Customers (first 3) ===')
  try {
    const raw = await qneGet<unknown>('/Customers', token) as unknown[]
    const customers = Array.isArray(raw) ? raw : (raw as Record<string, unknown[]>).value ?? []
    const first3 = (customers as Record<string, unknown>[]).slice(0, 3)
    first3.forEach(c => {
      console.log(`  Code: ${c['companyCode'] ?? '?'}  ID: ${c['id'] ?? '?'}  Name: ${c['companyName'] ?? '?'}`)
    })
    const testCode = String((first3[0] as Record<string, unknown>)?.['companyCode'] ?? '700-A001')
    const testId   = String((first3[0] as Record<string, unknown>)?.['id'] ?? '')

    // ── 2. Customer by ID (UUID) ────────────────────────────────────────────
    if (testId) {
      console.log(`\n=== GET /Customers/${testId} (by UUID) ===`)
      try {
        const cust = await qneGet<Record<string, unknown>>(`/Customers/${testId}`, token)
        console.log('Fields:', Object.keys(cust).join(', '))
        console.log('creditLimit:', cust['creditLimit'])
        console.log('term / paymentTerm:', cust['term'] ?? cust['paymentTerm'])
        console.log('currentBalance:', cust['currentBalance'])
      } catch (e) { console.log('Error:', e instanceof Error ? e.message : e) }
    }

    // ── 3. Try AgingSummary variants ────────────────────────────────────────
    const agingPaths = [
      `/Customers/AgingSummary`,
      `/Customers/AgingSummary?companyCode=${testCode}`,
      `/CustomerAging`,
      `/ARReports/CustomerLedgerDetail?customerCode=${testCode}`,
      `/ARReports/AgingSummary`,
      `/Customers/${testId}/AgingSummary`,
    ]
    for (const path of agingPaths) {
      console.log(`\n=== GET ${path} ===`)
      try {
        const res = await qneGet<unknown>(path, token)
        const rows = Array.isArray(res) ? res : (res as Record<string, unknown[]>)?.value ?? []
        console.log(`✓ SUCCESS — ${(rows as unknown[]).length} rows`)
        if ((rows as unknown[]).length > 0) {
          console.log('Fields:', Object.keys((rows as Record<string, unknown>[])[0]).join(', '))
          console.log('First row:', JSON.stringify((rows as Record<string, unknown>[])[0], null, 2))
        } else if (!Array.isArray(res)) {
          console.log('Response:', JSON.stringify(res, null, 2))
        }
        break // stop at first working endpoint
      } catch (e) { console.log('404 / Error') }
    }

    // ── 4. SalesInvoices — find the right customer filter param ────────────
    console.log(`\n=== GET /SalesInvoices — test customer filter params ===`)
    const filterVariants = [
      `/SalesInvoices?customer=${testCode}&$top=2`,
      `/SalesInvoices?companyCode=${testCode}&$top=2`,
      `/SalesInvoices?debtorCode=${testCode}&$top=2`,
      `/SalesInvoices/Find?customerCode=${testCode}`,
    ]
    for (const path of filterVariants) {
      try {
        const res = await qneGet<unknown>(path, token)
        const rows = Array.isArray(res) ? res : (res as Record<string, unknown[]>)?.value ?? []
        const filtered = (rows as Record<string, unknown>[]).filter(r =>
          r['customer'] === testCode || r['companyCode'] === testCode
        )
        console.log(`${path}  →  ${(rows as unknown[]).length} rows, ${filtered.length} matching ${testCode}`)
      } catch (e) { console.log(`${path}  →  Error`) }
    }

  } catch (e) {
    console.error('Failed to fetch customers:', e)
  }
}

main().catch(console.error)
