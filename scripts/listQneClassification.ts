/**
 * scripts/listQneClassification.ts
 * Discovery: prints the distinct QNE classification tree from live stock data.
 *
 *   category (top level)  >  group (subcategory, e.g. Pen)  >  class (brand)
 *
 * READ-ONLY — no DB writes, no QNE writes. Pages through GET /api/Stocks.
 *
 * Run: npx tsx scripts/listQneClassification.ts
 * Requires: Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import fetch from 'node-fetch'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE       ?? 'FKLSB'
const USERNAME = process.env.QNE_API_USERNAME  ?? 'SALES 6'
const PASSWORD = process.env.QNE_API_PASSWORD  ?? '12345'

async function getToken(): Promise<string> {
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

type QneStock = {
  stockCode: string
  isActive:  boolean
  isBundled: boolean
  category:  string | null
  group:     string | null
  class:     string | null
}

async function fetchAllStocks(token: string): Promise<QneStock[]> {
  const headers = { DbCode: DB_CODE, Authorization: `Bearer ${token}` }
  const all: QneStock[] = []
  let skip  = 0
  const top = 200

  while (true) {
    const res  = await fetch(`${BASE_URL}/api/Stocks?$top=${top}&$skip=${skip}`, { headers })
    const data = await res.json() as unknown
    const page: QneStock[] = Array.isArray(data)
      ? data as QneStock[]
      : ((data as Record<string, unknown>).value as QneStock[]) ?? ((data as Record<string, unknown>).data as QneStock[]) ?? []

    if (page.length === 0) break
    all.push(...page)
    process.stdout.write(`\r  Fetched ${all.length} items...`)
    if (page.length < top) break
    skip += top
  }
  console.log()
  return all
}

async function main() {
  console.log('=== QNE Classification Discovery (read-only) ===\n')
  const token  = await getToken()
  const stocks = await fetchAllStocks(token)

  const active = stocks.filter(s => s.isActive && !s.isBundled)
  console.log(`Total stocks: ${stocks.length} | Active non-bundled: ${active.length}\n`)

  // Build category → group → count tree
  const tree = new Map<string, Map<string, number>>()
  const brandsPerGroup = new Map<string, Set<string>>()

  for (const s of active) {
    const cat   = (s.category ?? '(no category)').trim() || '(no category)'
    const group = (s.group    ?? '(no group)').trim()    || '(no group)'
    if (!tree.has(cat)) tree.set(cat, new Map())
    const groups = tree.get(cat)!
    groups.set(group, (groups.get(group) ?? 0) + 1)

    const key = `${cat}>${group}`
    if (!brandsPerGroup.has(key)) brandsPerGroup.set(key, new Set())
    if (s.class?.trim()) brandsPerGroup.get(key)!.add(s.class.trim())
  }

  // Print sorted by category size desc
  const cats = [...tree.entries()].sort((a, b) => {
    const sumA = [...a[1].values()].reduce((x, y) => x + y, 0)
    const sumB = [...b[1].values()].reduce((x, y) => x + y, 0)
    return sumB - sumA
  })

  console.log('── QNE tree: category > group (item count) [brand count] ──\n')
  for (const [cat, groups] of cats) {
    const total = [...groups.values()].reduce((x, y) => x + y, 0)
    console.log(`${cat}  (${total})`)
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1])
    for (const [group, count] of sorted) {
      const brands = brandsPerGroup.get(`${cat}>${group}`)?.size ?? 0
      console.log(`  ${group}  (${count})  [${brands} brands]`)
    }
    console.log()
  }

  console.log(`Categories: ${tree.size} | Total category>group pairs: ${[...tree.values()].reduce((n, g) => n + g.size, 0)}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\nFatal:', err instanceof Error ? err.message : err)
  console.error('Is Radmin VPN connected?')
  process.exit(1)
})
