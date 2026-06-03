/**
 * Inspect QNE Stocks API — prints first 3 items to understand field names.
 * Run: npx tsx scripts/inspectQneStocks.ts
 * Requires: Radmin VPN connected to Flexxokl
 */
import fetch from 'node-fetch'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE       ?? 'FKLSB'
const USERNAME = process.env.QNE_API_USERNAME  ?? 'SALES 6'
const PASSWORD = process.env.QNE_API_PASSWORD  ?? '12345'

async function main() {
  console.log('=== QNE STOCKS INSPECT ===\n')

  // Login
  const loginRes  = await fetch(`${BASE_URL}/api/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
  })
  const loginData = await loginRes.json() as Record<string, unknown>
  const token     = String(loginData.token ?? loginData.Token ?? loginData.accessToken ?? '')
  if (!token) { console.error('Login failed:', loginData); process.exit(1) }
  console.log('✓ Logged in\n')

  const headers = { DbCode: DB_CODE, Authorization: `Bearer ${token}` }

  // Fetch first page of stocks
  const res  = await fetch(`${BASE_URL}/api/Stocks?$top=5`, { headers })
  const data = await res.json() as unknown

  const items: unknown[] = Array.isArray(data)
    ? data
    : (data as Record<string, unknown>).value as unknown[] ?? (data as Record<string, unknown>).data as unknown[] ?? []

  console.log(`Total items in response: ${items.length}`)
  console.log('\nFirst 3 items (full fields):')
  items.slice(0, 3).forEach((item, i) => {
    console.log(`\n--- Item ${i + 1} ---`)
    console.log(JSON.stringify(item, null, 2))
  })

  // Count total
  const countRes  = await fetch(`${BASE_URL}/api/Stocks?$count=true&$top=1`, { headers })
  const countData = await countRes.json() as Record<string, unknown>
  const total     = countData['@odata.count'] ?? countData.count ?? 'unknown'
  console.log(`\nTotal stock items in QNE: ${total}`)
}

main().catch(console.error)
