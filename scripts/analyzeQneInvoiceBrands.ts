/**
 * analyzeQneInvoiceBrands.ts
 * Pulls all QNE Sales Invoice line items, joins them with the stock master
 * for brand / category / spec data, then exports a multi-sheet Excel report.
 *
 * Output file: ./flexxo-invoice-brand-analysis-<date>.xlsx
 *
 * Sheets:
 *   1. Brand Summary      — brand, categories stocked, items sold, qty, revenue
 *   2. Item Detail        — every unique item: brand, category, code, name, unit, times invoiced, qty, revenue, avg price
 *   3. Top 50 by Revenue  — highest revenue items sorted descending
 *   4. Top 50 by Invoices — most frequently invoiced items sorted descending
 *
 * Run:  npx tsx scripts/analyzeQneInvoiceBrands.ts
 * Req:  Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local'), override: true })

import fetch from 'node-fetch'
import * as XLSX from 'xlsx'
import { writeFileSync } from 'fs'

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

type QneStock = {
  stockCode:     string
  stockName:     string
  class:         string | null   // brand in QNE
  category:      string | null   // top-level QNE category
  group:         string | null   // sub-category
  baseUOM:       string | null
  [key: string]: unknown
}

type QneInvoiceHeader = {
  id:         string
  docDate?:   string
  docNo?:     string
  refNo?:     string
  details?:   QneInvoiceLine[]
  [key: string]: unknown
}

type QneInvoiceLine = {
  stock?:      string   // QNE actual field name for item code
  itemCode?:   string
  stockCode?:  string
  description?: string
  qty?:        number
  unitPrice?:  number
  amount?:     number
  total?:      number
  nettAmount?: number
  [key: string]: unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  const d = data as Record<string, unknown>
  return (Array.isArray(d.value) ? d.value
       : Array.isArray(d.data)   ? d.data
       : []) as T[]
}

function lineItemCode(l: QneInvoiceLine): string | null {
  const c = l.stock ?? l.itemCode ?? l.stockCode ?? null
  return typeof c === 'string' && c.trim() ? c.trim() : null
}

function lineQty(l: QneInvoiceLine): number {
  return typeof l.qty === 'number' ? l.qty : 0
}

function lineRevenue(l: QneInvoiceLine): number {
  // Try various field names for line total
  const amt = l.amount ?? l.total ?? l.nettAmount ?? null
  if (typeof amt === 'number') return amt
  if (typeof l.qty === 'number' && typeof l.unitPrice === 'number') {
    return l.qty * l.unitPrice
  }
  return 0
}

function invoiceDate(inv: QneInvoiceHeader): string {
  return String(inv.docDate ?? inv.docNo ?? '').slice(0, 10) || 'unknown'
}

function invoiceDetailLines(detail: unknown): QneInvoiceLine[] {
  const d = detail as Record<string, unknown>
  for (const key of ['details', 'items', 'lines', 'invoiceDetails', 'salesInvoiceDetails']) {
    if (Array.isArray(d[key])) return d[key] as QneInvoiceLine[]
  }
  return []
}

// ── Aggregation type ──────────────────────────────────────────────────────────

type ItemAgg = {
  itemCode:      string
  itemName:      string
  brand:         string
  qneCategory:   string
  qneGroup:      string
  unit:          string
  invoiceCount:  number   // number of distinct invoices containing this item
  totalQty:      number
  totalRevenue:  number
  lastDate:      string
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Flexxo Invoice Brand Analysis ===\n')

  const token = await getToken()
  console.log('✓ QNE authenticated\n')

  // ── 1. Pull all stock master records (for brand/category info) ────────────
  console.log('Loading stock master (for brand/category data)...')
  const stockMap = new Map<string, QneStock>()
  let skip = 0
  const PAGE = 200
  while (true) {
    const data = await qneGet(`/api/Stocks?$top=${PAGE}&$skip=${skip}`, token)
    const page = toArray<QneStock>(data)
    if (page.length === 0) break
    for (const s of page) {
      if (s.stockCode) stockMap.set(s.stockCode.trim(), s)
    }
    process.stdout.write(`\r  ${stockMap.size} stock items loaded...`)
    if (page.length < PAGE) break
    skip += PAGE
  }
  console.log(`\n✓ Stock master: ${stockMap.size} items\n`)

  // ── 2. Fetch all invoice headers ──────────────────────────────────────────
  const invoices: QneInvoiceHeader[] = []
  skip = 0
  console.log('Fetching invoice list...')
  while (true) {
    const data = await qneGet(`/api/SalesInvoices?$top=${PAGE}&$skip=${skip}`, token)
    const page = toArray<QneInvoiceHeader>(data)
    if (page.length === 0) break
    invoices.push(...page)
    process.stdout.write(`\r  ${invoices.length} invoices...`)
    if (page.length < PAGE) break
    skip += PAGE
  }
  console.log(`\n✓ Total invoices: ${invoices.length}\n`)

  // ── 3. Extract line items ─────────────────────────────────────────────────
  const itemAgg = new Map<string, ItemAgg>()

  const firstHasDetails =
    invoices[0]?.details != null &&
    Array.isArray(invoices[0].details) &&
    invoices[0].details.length > 0

  async function processInvoice(inv: QneInvoiceHeader, lines: QneInvoiceLine[]) {
    const date   = invoiceDate(inv)
    const seenCodes = new Set<string>()

    for (const line of lines) {
      const code = lineItemCode(line)
      if (!code) continue

      const stock    = stockMap.get(code)
      const name     = typeof line.description === 'string' && line.description.trim()
                         ? line.description.trim()
                         : (stock?.stockName ?? code)
      const brand    = stock?.class?.trim()    || 'Unknown Brand'
      const category = stock?.category?.trim() || 'Unknown Category'
      const group    = stock?.group?.trim()    || ''
      const unit     = stock?.baseUOM?.trim()  || ''
      const qty      = lineQty(line)
      const revenue  = lineRevenue(line)

      const existing = itemAgg.get(code)
      if (existing) {
        existing.totalQty     += qty
        existing.totalRevenue += revenue
        if (!seenCodes.has(code)) {
          existing.invoiceCount++
        }
        if (date > existing.lastDate) existing.lastDate = date
      } else {
        itemAgg.set(code, {
          itemCode:     code,
          itemName:     name,
          brand,
          qneCategory:  category,
          qneGroup:     group,
          unit,
          invoiceCount: 1,
          totalQty:     qty,
          totalRevenue: revenue,
          lastDate:     date,
        })
      }
      seenCodes.add(code)
    }
  }

  if (firstHasDetails) {
    console.log('Line items are inline — processing...')
    for (const inv of invoices) {
      await processInvoice(inv, inv.details ?? [])
    }
  } else {
    console.log(`Fetching each invoice detail (${invoices.length} calls)...`)
    let i = 0
    let errors = 0
    for (const inv of invoices) {
      i++
      if (i % 25 === 0) process.stdout.write(`\r  ${i}/${invoices.length} (${errors} errors)`)
      try {
        const detail = await qneGet(`/api/SalesInvoices/${inv.id}`, token)
        await processInvoice(inv, invoiceDetailLines(detail))
      } catch {
        errors++
      }
    }
    console.log(`\n✓ Done (${errors} errors skipped)\n`)
  }

  const allItems = [...itemAgg.values()]
  console.log(`Unique items invoiced: ${allItems.length}\n`)

  // ── 4. Build Brand Summary ────────────────────────────────────────────────
  type BrandAgg = {
    brand:        string
    categories:   Set<string>
    uniqueItems:  number
    totalQty:     number
    totalRevenue: number
    invoiceCount: number
  }
  const brandMap = new Map<string, BrandAgg>()
  for (const item of allItems) {
    const existing = brandMap.get(item.brand)
    if (existing) {
      existing.categories.add(item.qneCategory)
      existing.uniqueItems++
      existing.totalQty     += item.totalQty
      existing.totalRevenue += item.totalRevenue
      existing.invoiceCount += item.invoiceCount
    } else {
      brandMap.set(item.brand, {
        brand:        item.brand,
        categories:   new Set([item.qneCategory]),
        uniqueItems:  1,
        totalQty:     item.totalQty,
        totalRevenue: item.totalRevenue,
        invoiceCount: item.invoiceCount,
      })
    }
  }

  const brandRows = [...brandMap.values()]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  // ── 5. Build Excel workbook ───────────────────────────────────────────────
  const wb = XLSX.utils.book_new()

  // Common column definition: Item Name first, then Brand
  // Used across all item-level sheets
  const itemCols = [
    'Rank',
    'Item Name',         // ← first: most important for scanning
    'Brand',             // ← second: what we want to know
    'Item Code',
    'QNE Category',
    'QNE Group',
    'Unit',
    'Times Invoiced',
    'Total Qty Sold',
    'Total Revenue (MYR)',
    'Avg Unit Price (MYR)',
    'Last Invoice Date',
  ]
  function itemRow(i: ItemAgg, rank: number): unknown[] {
    return [
      rank,
      i.itemName,
      i.brand,
      i.itemCode,
      i.qneCategory,
      i.qneGroup,
      i.unit,
      i.invoiceCount,
      +i.totalQty.toFixed(2),
      +i.totalRevenue.toFixed(2),
      i.totalQty > 0 ? +(i.totalRevenue / i.totalQty).toFixed(4) : 0,
      i.lastDate,
    ]
  }
  const itemColWidths = [
    { wch: 6 }, { wch: 55 }, { wch: 22 }, { wch: 20 },
    { wch: 22 }, { wch: 26 }, { wch: 8 },
    { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 18 },
  ]

  // ── Sheet 1: All Items by Invoice Count (primary analysis sheet) ──────────
  // Item name first, sorted by Times Invoiced DESC.
  // Use this to scan "what we sell most → what brand it is."
  const byFreq = [...allItems].sort((a, b) => b.invoiceCount - a.invoiceCount)
  const ws1 = XLSX.utils.aoa_to_sheet([itemCols, ...byFreq.map((i, idx) => itemRow(i, idx + 1))])
  ws1['!cols'] = itemColWidths
  XLSX.utils.book_append_sheet(wb, ws1, 'By Invoice Frequency')

  // ── Sheet 2: All Items by Revenue ─────────────────────────────────────────
  const byRev = [...allItems].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const ws2 = XLSX.utils.aoa_to_sheet([itemCols, ...byRev.map((i, idx) => itemRow(i, idx + 1))])
  ws2['!cols'] = itemColWidths
  XLSX.utils.book_append_sheet(wb, ws2, 'By Revenue')

  // ── Sheet 3: Brand Summary (with top 5 items per brand) ───────────────────
  // For each brand: revenue, invoice count, AND the top 5 item names so you
  // can see at a glance what each brand actually sells.
  const itemsByBrand = new Map<string, ItemAgg[]>()
  for (const item of allItems) {
    const list = itemsByBrand.get(item.brand) ?? []
    list.push(item)
    itemsByBrand.set(item.brand, list)
  }

  const brandHeader = [
    'Brand',
    'Total Revenue (MYR)',
    'Total Invoices',
    'Unique Items',
    'Top 5 Items by Invoice Count',
    'Categories',
  ]
  const brandSummaryRows = brandRows.map(b => {
    const items = (itemsByBrand.get(b.brand) ?? [])
      .sort((x, y) => y.invoiceCount - x.invoiceCount)
      .slice(0, 5)
      .map(x => `${x.itemName} (${x.invoiceCount}×)`)
      .join(' | ')
    return [
      b.brand,
      +b.totalRevenue.toFixed(2),
      b.invoiceCount,
      b.uniqueItems,
      items,
      [...b.categories].filter(Boolean).sort().join(', '),
    ]
  })
  const ws3 = XLSX.utils.aoa_to_sheet([brandHeader, ...brandSummaryRows])
  ws3['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 90 }, { wch: 50 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'Brand Summary')

  // ── Sheet 4: Brand Preference Guide ──────────────────────────────────────
  // PURPOSE: Feed this sheet back to Claude to auto-generate brand preference
  // rules. For each common product keyword, shows the #1 brand by invoice count.
  //
  // Columns: Product Keyword | #1 Brand | Invoices | Example Items | Rivals
  //
  // Method: tokenise item names → group by word → find dominant brand per word

  // Build word → { brand → count } map from all invoiced items
  const wordBrandMap = new Map<string, Map<string, number>>()
  const STOP = new Set([
    'the','and','for','with','pcs','box','set','pack','roll','bxs','card',
    'per','nos','lot','bag','bkt','ctn','doz','ream','tub','btl','tube',
    'x','a','of','in','to','cm','mm','ml','kg','gm','gr','ltr','mtr',
    '1','2','3','4','5','6','7','8','9','0','no','na',
    '20card','20','18','12','10','48','36','24','80','60','100','150','200',
    'unknown','brand','others','otehrs','otehr',
  ])

  for (const item of allItems) {
    if (item.brand === 'Unknown Brand' || item.brand === 'OTEHRS' || item.brand === 'OTEHR') continue
    const words = item.itemName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))

    for (const word of words) {
      const brandCounts = wordBrandMap.get(word) ?? new Map<string, number>()
      brandCounts.set(item.brand, (brandCounts.get(item.brand) ?? 0) + item.invoiceCount)
      wordBrandMap.set(word, brandCounts)
    }
  }

  // Keep only words that appear across ≥3 items and have ≥10 total invoices
  type GuideRow = {
    keyword:     string
    topBrand:    string
    topCount:    number
    totalCount:  number
    dominance:   number  // topBrand's share of total
    examples:    string
    rivals:      string
  }

  const guideRows: GuideRow[] = []
  for (const [word, brandCounts] of wordBrandMap.entries()) {
    const total     = [...brandCounts.values()].reduce((s, n) => s + n, 0)
    if (total < 10) continue

    // How many distinct items contain this word?
    const matchCount = allItems.filter(i =>
      i.itemName.toLowerCase().includes(word) &&
      i.brand !== 'Unknown Brand'
    ).length
    if (matchCount < 3) continue

    const sorted   = [...brandCounts.entries()].sort((a, b) => b[1] - a[1])
    const topBrand = sorted[0]![0]
    const topCount = sorted[0]![1]
    const dominance = Math.round((topCount / total) * 100)

    const examples = allItems
      .filter(i => i.itemName.toLowerCase().includes(word) && i.brand === topBrand)
      .sort((a, b) => b.invoiceCount - a.invoiceCount)
      .slice(0, 3)
      .map(i => i.itemName)
      .join(' | ')

    const rivals = sorted.slice(1, 4)
      .map(([brand, cnt]) => `${brand} (${cnt})`)
      .join(', ')

    guideRows.push({ keyword: word, topBrand, topCount, totalCount: total, dominance, examples, rivals })
  }

  // Sort by total invoice count descending — most relevant product types first
  guideRows.sort((a, b) => b.totalCount - a.totalCount)

  const guideHeader = [
    'Product Keyword',
    '#1 Brand',
    'Brand Invoices',
    'Total Invoices (all brands)',
    'Brand Dominance %',
    'Example Items',
    'Other Brands (invoices)',
  ]
  const ws4 = XLSX.utils.aoa_to_sheet([
    guideHeader,
    ...guideRows.map(r => [
      r.keyword,
      r.topBrand,
      r.topCount,
      r.totalCount,
      r.dominance,
      r.examples,
      r.rivals,
    ]),
  ])
  ws4['!cols'] = [
    { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 18 },
    { wch: 80 }, { wch: 45 },
  ]
  XLSX.utils.book_append_sheet(wb, ws4, 'Brand Preference Guide')

  // ── 6. Write file ─────────────────────────────────────────────────────────
  const date     = new Date().toISOString().slice(0, 10)
  const filename = `flexxo-invoice-brand-analysis-${date}.xlsx`
  const filepath = resolve(process.cwd(), filename)

  writeFileSync(filepath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  console.log(`✓ Excel written: ${filename}\n`)

  // ── 7. Console summary ────────────────────────────────────────────────────
  console.log('── Top 20 Most-Invoiced Items (Item Name + Brand) ──────────────')
  console.log(
    'Rank'.padEnd(6) +
    'Item Name'.padEnd(45) +
    'Brand'.padEnd(22) +
    'Invoices'.padStart(10),
  )
  console.log('─'.repeat(83))
  for (const [idx, i] of byFreq.slice(0, 20).entries()) {
    console.log(
      String(idx + 1).padEnd(6) +
      i.itemName.slice(0, 44).padEnd(45) +
      i.brand.padEnd(22) +
      String(i.invoiceCount).padStart(10),
    )
  }

  console.log('\n── Top 10 Items by Revenue ─────────────────────────────────────')
  console.log(
    'Item Name'.padEnd(45) +
    'Brand'.padEnd(22) +
    'Revenue (MYR)'.padStart(16),
  )
  console.log('─'.repeat(83))
  for (const i of byRev.slice(0, 10)) {
    console.log(
      i.itemName.slice(0, 44).padEnd(45) +
      i.brand.padEnd(22) +
      String(i.totalRevenue.toFixed(2)).padStart(16),
    )
  }

  console.log(`\n=== Analysis complete. Open ${filename} for full report. ===`)
}

main()
  .catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
