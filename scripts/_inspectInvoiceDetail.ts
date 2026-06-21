/**
 * One-off: print the raw QNE invoice detail response to find line-item field names.
 * Run: npx tsx scripts/_inspectInvoiceDetail.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local'), override: true })

import fetch from 'node-fetch'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE      ?? 'FKLSB'
const USER     = process.env.QNE_API_USERNAME ?? 'SALES 6'
const PASS     = process.env.QNE_API_PASSWORD ?? '12345'

async function run() {
  // Auth
  const loginRes = await fetch(`${BASE_URL}/api/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dbCode: DB_CODE, userName: USER, password: PASS }),
  })
  const loginData = await loginRes.json() as Record<string, unknown>
  const token = String(loginData.token ?? loginData.Token ?? loginData.accessToken ?? '')
  if (!token) { console.error('Login failed:', JSON.stringify(loginData)); process.exit(1) }
  console.log('✓ Authenticated\n')

  const headers = { DbCode: DB_CODE, Authorization: `Bearer ${token}` }

  // Fetch list (first 1)
  const listRes = await fetch(`${BASE_URL}/api/SalesInvoices?$top=1`, { headers })
  const listRaw = await listRes.json() as unknown
  console.log('=== LIST RAW STRUCTURE ===')
  const listText = JSON.stringify(listRaw, null, 2).slice(0, 2000)
  console.log(listText)

  const listArr = Array.isArray(listRaw)
    ? listRaw as Record<string, unknown>[]
    : Array.isArray((listRaw as Record<string, unknown>).value)
      ? (listRaw as Record<string, unknown>).value as Record<string, unknown>[]
      : (Array.isArray((listRaw as Record<string, unknown>).data)
          ? (listRaw as Record<string, unknown>).data as Record<string, unknown>[]
          : [])

  if (listArr.length === 0) { console.log('\nNo invoices in list!'); return }

  const first = listArr[0]!
  const id = first['id'] ?? first['Id'] ?? first['invoiceId'] ?? first['ID']
  console.log('\n=== FIRST INVOICE ID:', id)
  console.log('List item keys:', Object.keys(first))

  // Check if list has inline details
  for (const [k, v] of Object.entries(first)) {
    if (Array.isArray(v)) {
      console.log(`  LIST has ARRAY key: "${k}" (length ${(v as unknown[]).length})`)
    }
  }

  if (!id) { console.log('Cannot determine invoice ID field'); return }

  // Fetch detail
  const detailRes = await fetch(`${BASE_URL}/api/SalesInvoices/${String(id)}`, { headers })
  const detail    = await detailRes.json() as Record<string, unknown>
  console.log('\n=== DETAIL RESPONSE (first 3000 chars) ===')
  console.log(JSON.stringify(detail, null, 2).slice(0, 3000))

  console.log('\n=== DETAIL KEYS ===')
  for (const [k, v] of Object.entries(detail)) {
    if (Array.isArray(v)) {
      const arr = v as Record<string, unknown>[]
      console.log(`  ARRAY key: "${k}" (length ${arr.length}) → first item keys: ${Object.keys(arr[0] ?? {}).join(', ')}`)
    } else {
      console.log(`  "${k}": ${typeof v} = ${String(v).slice(0, 80)}`)
    }
  }
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
