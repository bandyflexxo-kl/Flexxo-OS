/**
 * Diagnostic: does QNE actually return a BARCODE, and under what field name?
 *
 * The product sync (syncQneProducts.ts) reads `stock.barcode` (+ ean/barcodeNo/
 * eanCode/upc) but NEVER `barCode` (capital C — the name QNE's write API uses) and
 * never the UOM-level barcode. Result so far: 0/7,539 products have a barcode.
 *
 * This script pulls a handful of real stock records and prints their exact keys +
 * any barcode value found at stock level OR UOM level, so we can tell whether the
 * data exists in QNE (sync field-name bug) or genuinely isn't entered there.
 *
 * Run with Radmin VPN active:  npx tsx scripts/_qneBarcodeCheck.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import fetch from 'node-fetch'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE       ?? 'FKLSB'
const USERNAME = process.env.QNE_API_USERNAME  ?? process.env.QNE_USERNAME ?? 'SALES 6'
const PASSWORD = process.env.QNE_API_PASSWORD  ?? process.env.QNE_PASSWORD ?? '12345'

const STOCK_BC_FIELDS = ['barCode', 'barcode', 'ean', 'eanCode', 'barcodeNo', 'upc', 'barCodeNo']

async function login(): Promise<string> {
  const res  = await fetch(`${BASE_URL}/api/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
  })
  const data = await res.json() as Record<string, unknown>
  const token = String(data.token ?? data.Token ?? data.accessToken ?? '')
  if (!token) throw new Error(`QNE login failed: ${JSON.stringify(data)}`)
  return token
}

function pickBarcode(obj: Record<string, unknown>, fields: string[]): { field: string; value: string } | null {
  for (const f of fields) {
    const v = obj[f]
    if (v != null && String(v).trim() !== '') return { field: f, value: String(v).trim() }
  }
  return null
}

async function main() {
  console.log(`QNE: ${BASE_URL}  db=${DB_CODE}  user=${USERNAME}`)
  const token   = await login()
  const headers = { DbCode: DB_CODE, Authorization: `Bearer ${token}` }

  // Pull a sample page of stocks.
  const url  = `${BASE_URL}/api/Stocks?$top=25&$skip=0`
  const res  = await fetch(url, { headers })
  const data = await res.json() as unknown
  const page = (Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>).value ?? (data as Record<string, unknown>).data ?? [])) as Record<string, unknown>[]

  if (page.length === 0) { console.log('No stocks returned.'); return }

  console.log(`\nFetched ${page.length} stock records.`)
  console.log('\n=== Top-level keys of first record ===')
  console.log(Object.keys(page[0]).join(', '))

  // Show any UOM array shape on the first record.
  const uomKey = Object.keys(page[0]).find(k => /uom/i.test(k) && Array.isArray((page[0] as Record<string, unknown>)[k]))
  if (uomKey) {
    const firstUom = ((page[0] as Record<string, unknown>)[uomKey] as Record<string, unknown>[])[0]
    console.log(`\n=== UOM array field: "${uomKey}" — keys of first UOM row ===`)
    console.log(firstUom ? Object.keys(firstUom).join(', ') : '(empty array)')
  } else {
    console.log('\n(no UOM array field found at stock level)')
  }

  // Probe every record: stock-level + UOM-level barcode.
  let stockHits = 0, uomHits = 0
  const fieldTally: Record<string, number> = {}
  console.log('\n=== Per-record barcode probe ===')
  for (const s of page) {
    const code = String(s.stockCode ?? s.code ?? '?')
    const stockBc = pickBarcode(s, STOCK_BC_FIELDS)
    if (stockBc) { stockHits++; fieldTally[stockBc.field] = (fieldTally[stockBc.field] ?? 0) + 1 }

    let uomBc: { field: string; value: string } | null = null
    if (uomKey && Array.isArray(s[uomKey])) {
      for (const u of s[uomKey] as Record<string, unknown>[]) {
        const hit = pickBarcode(u, STOCK_BC_FIELDS)
        if (hit) { uomBc = hit; break }
      }
      if (uomBc) uomHits++
    }

    if (stockBc || uomBc) {
      console.log(`  ${code.padEnd(22)} stock:${stockBc ? `${stockBc.field}=${stockBc.value}` : '—'}  uom:${uomBc ? `${uomBc.field}=${uomBc.value}` : '—'}`)
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Records sampled:           ${page.length}`)
  console.log(`Stock-level barcode found: ${stockHits}  ${stockHits ? `(fields: ${JSON.stringify(fieldTally)})` : ''}`)
  console.log(`UOM-level barcode found:   ${uomHits}`)
  if (stockHits === 0 && uomHits === 0) {
    console.log('\n→ QNE returns NO barcode in this sample. The data likely isn\'t entered in QNE.')
  } else {
    console.log('\n→ QNE HAS barcode data. Fix syncQneProducts to read the field name(s) above, then re-sync.')
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
