/**
 * Checks qneItemCode values in products table and compares with KT invoice item codes.
 * Requires Radmin VPN active.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const withCode = await prisma.product.count({ where: { qneItemCode: { not: null } } })
  const total    = await prisma.product.count()
  console.log(`Products with qneItemCode: ${withCode} / ${total}`)

  const sample = await prisma.product.findMany({
    where:  { qneItemCode: { not: null } },
    take:   8,
    select: { qneItemCode: true, name: true },
  })
  console.log('\nSample DB qneItemCodes:')
  sample.forEach(p => console.log(`  "${p.qneItemCode}" | ${p.name?.slice(0, 40)}`))

  // Now fetch real KT invoice item codes from QNE
  const rawUrl   = process.env.QNE_API_URL ?? 'http://26.255.19.220:82/api'
  const QNE_BASE = rawUrl.replace(/\/api\/?$/, '')
  const QNE_API  = `${QNE_BASE}/api`
  const DB_CODE  = process.env.QNE_DB_CODE ?? 'FKLSB'

  const loginRes  = await fetch(`${QNE_API}/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', DbCode: DB_CODE },
    body: JSON.stringify({ dbCode: DB_CODE, userName: process.env.QNE_API_USERNAME ?? 'SALES 6', password: process.env.QNE_API_PASSWORD ?? '12345' }),
    signal: AbortSignal.timeout(8000),
  })
  if (!loginRes.ok) { console.log('\nQNE login failed — VPN active?'); return }
  const { token } = await loginRes.json() as { token: string }
  const headers = { Authorization: `Bearer ${token}`, DbCode: DB_CODE }

  // Fetch first KT invoice detail
  const invRes = await fetch(`${QNE_API}/SalesInvoices?pageSize=200`, { headers })
  const allInvs = Object.values(await invRes.json() as Record<string, unknown>)
  const ktInvs  = (allInvs as Record<string, string>[]).filter(i =>
    i.customer === '700-K016' && String(i.invoiceCode ?? '').startsWith('INV')
  )
  if (!ktInvs[0]) { console.log('\nNo KT invoices found'); return }

  const detailRes = await fetch(`${QNE_API}/SalesInvoices/${ktInvs[0].id}`, { headers })
  const detail = await detailRes.json() as Record<string, unknown>
  const items  = (Array.isArray(detail.items) ? detail.items : []) as Record<string, string>[]

  console.log(`\nKT invoice "${ktInvs[0].invoiceCode}" — ${items.length} line items:`)
  items.slice(0, 8).forEach(i => console.log(`  stock="${i.stock}" | desc="${String(i.description ?? '').slice(0,40)}"`))

  // Try matching first 5 KT items to DB products
  console.log('\nMatch attempts:')
  for (const item of items.slice(0, 5)) {
    const code = item.stock ?? ''
    const match = code ? await prisma.product.findFirst({ where: { qneItemCode: code }, select: { id: true, name: true } }) : null
    console.log(`  "${code}" → ${match ? `✅ ${match.name?.slice(0,35)}` : '❌ no match'}`)
  }
}

main().then(() => { process.exit(0) }).catch(e => { console.error(e.message); process.exit(1) })
