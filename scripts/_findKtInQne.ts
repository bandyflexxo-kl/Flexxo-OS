import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const rawUrl   = process.env.QNE_API_URL ?? 'http://26.255.19.220:82/api'
  const QNE_BASE = rawUrl.replace(/\/api\/?$/, '')
  const QNE_API  = `${QNE_BASE}/api`
  const DB_CODE  = process.env.QNE_DB_CODE ?? 'FKLSB'
  const USERNAME = process.env.QNE_USERNAME ?? 'SALES 6'
  const PASSWORD = process.env.QNE_PASSWORD ?? '12345'

  const loginRes  = await fetch(`${QNE_API}/Users/Login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', DbCode: DB_CODE },
    body: JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
  })
  const loginData = await loginRes.json() as { token?: string; accessToken?: string }
  const token     = loginData.token ?? loginData.accessToken ?? ''
  if (!token) { console.log('Login failed'); return }
  console.log('QNE login OK\n')

  const headers = { Authorization: `Bearer ${token}`, DbCode: DB_CODE, 'Content-Type': 'application/json' }

  // GET /api/Customers returns a flat array (numeric keys)
  const r = await fetch(`${QNE_API}/Customers`, { headers })
  const raw = await r.json()
  // Convert object-with-numeric-keys to array
  const customers: Record<string, string>[] = Array.isArray(raw)
    ? raw
    : Object.values(raw as Record<string, Record<string, string>>)

  console.log(`Total customers from QNE: ${customers.length}`)

  // Search for KT Ultimate
  const kt = customers.find(c => {
    const name = (c.name ?? c.companyName ?? c.customerName ?? '').toString().toUpperCase()
    return name.includes('KT ULTIMATE') || name.includes('KT ULTI')
  })

  if (!kt) {
    // Print all names containing KT
    const ktMatches = customers.filter(c => {
      const name = (c.name ?? c.companyName ?? '').toString().toUpperCase()
      return name.includes('KT ')
    })
    console.log(`\nNo exact "KT ULTIMATE" match. Names containing "KT ": ${ktMatches.length}`)
    ktMatches.forEach(c => console.log(`  ${c.name ?? c.companyName ?? JSON.stringify(c).slice(0, 80)}`))

    // Print first customer's full structure to understand field names
    console.log('\nFirst customer object keys:', Object.keys(customers[0] ?? {}))
    console.log('First customer:', JSON.stringify(customers[0]).slice(0, 300))
    return
  }

  console.log('Found KT:', JSON.stringify(kt).slice(0, 300))

  // Use code/id to fetch invoices
  const code = kt.code ?? kt.customerCode ?? kt.id ?? ''
  console.log(`\nFetching invoices for code: ${code}`)
  const invRes  = await fetch(`${QNE_API}/SalesInvoices?customerCode=${encodeURIComponent(code)}&pageSize=20`, { headers })
  const invData = await invRes.json()
  const invoices: Record<string, unknown>[] = Array.isArray(invData)
    ? invData
    : Object.values(invData as Record<string, Record<string, unknown>>)

  console.log(`Invoices: ${invoices.length}`)
  invoices.slice(0, 5).forEach(inv => {
    console.log(`  ${inv.docNo ?? inv.referenceNo ?? inv.id} | RM${inv.totalAmt ?? inv.totalAmount ?? inv.amount}`)
  })
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
