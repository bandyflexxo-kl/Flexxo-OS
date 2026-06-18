/**
 * Inspect QNE SalesInvoices API response structure.
 * Run once with VPN to figure out field names, then update analyzeOfficeSupplyCost.ts.
 */
import fetch from 'node-fetch'

const BASE   = process.env.QNE_API_BASE_URL || 'http://26.255.19.220:82'
const DBCODE = process.env.QNE_DB_CODE      || 'FKLSB'
const USER   = process.env.QNE_API_USERNAME || 'SALES 6'
const PASS   = process.env.QNE_API_PASSWORD || '12345'

async function login() {
  const res = await fetch(`${BASE}/api/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', DbCode: DBCODE },
    body: JSON.stringify({ dbCode: DBCODE, userName: USER, password: PASS }),
  })
  const data = await res.json() as any
  return data.token || data.Token || data.accessToken
}

async function main() {
  const token = await login()
  console.log('✅ Logged in\n')
  const hdrs = { Authorization: `Bearer ${token}`, DbCode: DBCODE, 'Content-Type': 'application/json' }

  // ── 1. List endpoint (first 3 records only) ──
  console.log('=== GET /api/SalesInvoices (first 3) ===')
  const listRes = await fetch(`${BASE}/api/SalesInvoices?pageSize=3&page=1`, { headers: hdrs })
  const listRaw = await listRes.json() as any
  console.log('Top-level keys:', Object.keys(listRaw))

  // Figure out where the array is
  let invoices: any[] = []
  if (Array.isArray(listRaw))                        invoices = listRaw.slice(0,3)
  else if (Array.isArray(listRaw.data))              invoices = listRaw.data.slice(0,3)
  else if (Array.isArray(listRaw.items))             invoices = listRaw.items.slice(0,3)
  else if (Array.isArray(listRaw.result))            invoices = listRaw.result.slice(0,3)
  else if (Array.isArray(listRaw.salesInvoices))     invoices = listRaw.salesInvoices.slice(0,3)

  console.log(`Found ${invoices.length} invoices at top-level`)
  if (invoices.length > 0) {
    console.log('\nFirst invoice keys:', Object.keys(invoices[0]))
    console.log('First invoice sample:\n', JSON.stringify(invoices[0], null, 2).substring(0, 1500))
  } else {
    console.log('Raw response (first 2000 chars):', JSON.stringify(listRaw, null, 2).substring(0, 2000))
  }

  // ── 2. Detail endpoint for the first invoice ──
  if (invoices.length > 0) {
    const inv = invoices[0]
    const id = inv.docNo || inv.invoiceNo || inv.id || inv.ID || inv.DocNo
    console.log(`\n=== GET /api/SalesInvoices/${id} (detail) ===`)
    if (id) {
      const detRes = await fetch(`${BASE}/api/SalesInvoices/${encodeURIComponent(id)}`, { headers: hdrs })
      const detRaw = await detRes.json() as any
      console.log('Detail top-level keys:', Object.keys(detRaw))
      console.log('Detail (first 2000 chars):\n', JSON.stringify(detRaw, null, 2).substring(0, 2000))
    }
  }

  // ── 3. Try /api/SalesInvoices/Find ──
  console.log('\n=== GET /api/SalesInvoices/Find (sample) ===')
  const findRes = await fetch(`${BASE}/api/SalesInvoices/Find?pageSize=3`, { headers: hdrs })
  if (findRes.ok) {
    const findRaw = await findRes.json() as any
    console.log('Find keys:', Object.keys(findRaw))
    console.log('Find sample:\n', JSON.stringify(findRaw, null, 2).substring(0, 1000))
  } else {
    console.log('Find endpoint returned:', findRes.status)
  }
}

main().catch(console.error)
