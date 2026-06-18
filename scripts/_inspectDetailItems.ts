/**
 * Inspect the `details` array items inside a QNE SalesInvoice.
 * Run once with VPN to confirm field names for analyzeOfficeSupplyCost.ts.
 */
import fetch from 'node-fetch'

const BASE   = process.env.QNE_API_BASE_URL || 'http://26.255.19.220:82'
const DBCODE = process.env.QNE_DB_CODE      || 'FKLSB'
const USER   = process.env.QNE_API_USERNAME || 'SALES 6'
const PASS   = process.env.QNE_API_PASSWORD || '12345'

async function main() {
  const loginRes = await fetch(`${BASE}/api/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', DbCode: DBCODE },
    body: JSON.stringify({ dbCode: DBCODE, userName: USER, password: PASS }),
  })
  const { token } = await loginRes.json() as any
  const hdrs = { Authorization: `Bearer ${token}`, DbCode: DBCODE }

  // Fetch invoice list — all 3854 come back at once as numeric-keyed object
  console.log('Fetching invoice list...')
  const listRes = await fetch(`${BASE}/api/SalesInvoices`, { headers: hdrs })
  const listRaw = await listRes.json() as any
  const invoices = Object.values(listRaw) as any[]
  console.log(`Total invoices: ${invoices.length}`)

  // Find first non-cancelled invoice from 2024
  const inv = invoices.find((i: any) =>
    !i.isCancelled && i.invoiceDate?.startsWith('2024')
  )
  if (!inv) { console.log('No 2024 invoice found'); return }

  console.log(`\nSample invoice: ${inv.invoiceCode} — ${inv.invoiceDate} — ${inv.customerName}`)
  console.log(`UUID (id): ${inv.id}`)
  console.log(`totalAmount: ${inv.totalAmount}`)

  // Fetch detail
  console.log('\nFetching detail...')
  const detRes = await fetch(`${BASE}/api/SalesInvoices/${inv.id}`, { headers: hdrs })
  const det = await detRes.json() as any

  console.log('\nDetail top-level keys:', Object.keys(det))
  console.log(`details array length: ${det.details?.length ?? 'N/A'}`)

  if (det.details?.length > 0) {
    console.log('\nFirst detail item keys:', Object.keys(det.details[0]))
    console.log('\nFirst 3 detail items:')
    det.details.slice(0, 3).forEach((d: any, i: number) => {
      console.log(`\n  [${i}]`, JSON.stringify(d, null, 4))
    })
  }

  // Also try a 2023 invoice to check if the field names differ
  const inv2 = invoices.find((i: any) =>
    !i.isCancelled && i.invoiceDate?.startsWith('2023') && i.id !== inv.id
  )
  if (inv2) {
    console.log(`\n--- Also checking 2023 invoice: ${inv2.invoiceCode} ---`)
    const det2Res = await fetch(`${BASE}/api/SalesInvoices/${inv2.id}`, { headers: hdrs })
    const det2 = await det2Res.json() as any
    if (det2.details?.[0]) {
      console.log('2023 first detail item keys:', Object.keys(det2.details[0]))
      console.log('2023 sample detail[0]:', JSON.stringify(det2.details[0], null, 2))
    }
  }
}

main().catch(console.error)
