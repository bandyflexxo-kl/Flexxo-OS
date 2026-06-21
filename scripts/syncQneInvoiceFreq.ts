/**
 * syncQneInvoiceFreq.ts
 * Counts how many QNE Sales Invoices each item appeared in, then writes
 * that count to products.qne_invoice_freq.
 *
 * Why invoices (not quotations)?
 *   Invoices are confirmed sales — the customer definitely bought the item.
 *   Quotation counts include rejected / expired quotes that never shipped.
 *
 * Run:  npx tsx scripts/syncQneInvoiceFreq.ts
 * Req:  Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local'), override: true })

import fetch from 'node-fetch'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE       ?? 'FKLSB'
const USERNAME = process.env.QNE_API_USERNAME  ?? 'SALES 6'
const PASSWORD = process.env.QNE_API_PASSWORD  ?? '12345'

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
  })
  const data = await res.json() as Record<string, unknown>
  const token = String(data.token ?? data.Token ?? data.accessToken ?? '')
  if (!token) throw new Error(`QNE login failed: ${JSON.stringify(data)}`)
  return token
}

async function qneGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { DbCode: DB_CODE, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────

type QneInvoiceHeader = {
  id:        string
  details?:  QneInvoiceLine[]   // present if list endpoint returns details inline
  [key: string]:  unknown
}

type QneInvoiceLine = {
  stock?:     string   // QNE actual field name for item code
  itemCode?:  string
  stockCode?: string
  [key: string]: unknown
}

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  const d = data as Record<string, unknown>
  return (Array.isArray(d.value) ? d.value : Array.isArray(d.data) ? d.data : []) as T[]
}

function lineItemCode(line: QneInvoiceLine): string | null {
  const code = line.stock ?? line.itemCode ?? line.stockCode ?? null
  return typeof code === 'string' && code.trim() ? code.trim() : null
}

function invoiceDetailLines(detail: unknown): QneInvoiceLine[] {
  const d = detail as Record<string, unknown>
  for (const key of ['details', 'items', 'lines', 'invoiceDetails', 'salesInvoiceDetails']) {
    if (Array.isArray(d[key])) return d[key] as QneInvoiceLine[]
  }
  return []
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('../lib/prisma')
  console.log('=== Sync QNE Invoice Frequency → products.qne_invoice_freq ===\n')

  const token = await getToken()
  console.log('✓ QNE authenticated\n')

  // ── Step 1: Fetch all invoice headers (paginated) ────────────────────────
  const headers: QneInvoiceHeader[] = []
  let skip = 0
  const PAGE = 200

  console.log('Fetching invoice list...')
  while (true) {
    const data = await qneGet(`/api/SalesInvoices?$top=${PAGE}&$skip=${skip}`, token)
    const page = toArray<QneInvoiceHeader>(data)
    if (page.length === 0) break
    headers.push(...page)
    process.stdout.write(`\r  ${headers.length} invoices fetched...`)
    if (page.length < PAGE) break
    skip += PAGE
  }
  console.log(`\n✓ Total invoices: ${headers.length}\n`)

  // ── Step 2: Extract item codes (inline or via detail calls) ──────────────
  // freqMap: itemCode → count of distinct invoices that contain it
  const freqMap = new Map<string, number>()

  const firstHasDetails =
    headers[0]?.details != null && Array.isArray(headers[0].details) && headers[0].details.length > 0

  if (firstHasDetails) {
    // Details are embedded in the list response — no extra calls needed
    console.log('Invoice line items are inline in list response.\n')
    for (const inv of headers) {
      const seen = new Set<string>()
      for (const line of (inv.details ?? [])) {
        const code = lineItemCode(line)
        if (code && !seen.has(code)) {
          freqMap.set(code, (freqMap.get(code) ?? 0) + 1)
          seen.add(code)
        }
      }
    }
  } else {
    // Fetch each invoice detail separately
    console.log(`Fetching detail for each invoice (${headers.length} calls)...`)
    console.log('Tip: this may take a few minutes. Keep VPN connected.\n')

    let i = 0
    let errors = 0
    for (const inv of headers) {
      i++
      if (i % 25 === 0) process.stdout.write(`\r  Progress: ${i}/${headers.length} (${errors} errors)`)

      try {
        const detail = await qneGet(`/api/SalesInvoices/${inv.id}`, token)
        const lines  = invoiceDetailLines(detail)
        const seen   = new Set<string>()
        for (const line of lines) {
          const code = lineItemCode(line)
          if (code && !seen.has(code)) {
            freqMap.set(code, (freqMap.get(code) ?? 0) + 1)
            seen.add(code)
          }
        }
      } catch {
        errors++
      }
    }
    console.log(`\n✓ Done. ${errors} invoice detail fetch errors (skipped).\n`)
  }

  console.log(`Unique item codes found across all invoices: ${freqMap.size}\n`)

  // ── Step 3: Update products.qne_invoice_freq ─────────────────────────────
  console.log('Updating product invoice frequencies in DB...')
  let updated = 0

  for (const [code, count] of freqMap.entries()) {
    const result = await prisma.product.updateMany({
      where: { qneItemCode: code },
      data:  { qneInvoiceFreq: count },
    })
    updated += result.count
  }

  // Zero out products whose item code doesn't appear in any invoice
  await prisma.product.updateMany({
    where: { qneItemCode: { notIn: [...freqMap.keys()] } },
    data:  { qneInvoiceFreq: 0 },
  })

  console.log(`✓ Updated ${updated} products\n`)

  // ── Step 4: Print top 20 ──────────────────────────────────────────────────
  const top20 = [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  console.log('Top 20 most-invoiced items (by invoice count):')
  console.log('─'.repeat(50))
  for (const [code, count] of top20) {
    console.log(`  ${code.padEnd(20)} ${count} invoices`)
  }

  console.log('\n=== Done. Run syncQneInvoiceFreq.ts periodically to keep counts fresh. ===')
}

main()
  .catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
