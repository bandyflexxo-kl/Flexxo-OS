/**
 * Offline fallback: analyze office supply patterns from CRM quotation data.
 * No VPN needed — reads from local Supabase DB.
 *
 * This covers quotations created in the Flexxo CRM, not the full QNE invoice history.
 * For complete historical analysis use analyzeOfficeSupplyCost.ts (requires Radmin VPN).
 */

import { prisma } from '@/lib/prisma'

const CATEGORIES: Record<string, string[]> = {
  'A4 Paper':        ['a4', 'copier paper', 'paper a4', 'white paper', 'a4 paper'],
  'Cartridge / Ink': ['cartridge', 'toner', 'ink', 'inkjet'],
  'Ball Pen':        ['ball pen', 'ballpen', 'ballpoint', 'biro', 'pilot', 'uni-ball', 'uniball'],
  'Correction Tape': ['correction tape', 'correction fluid', 'whiteout', 'white out'],
  'Pantry Items':    ['coffee', 'milo', 'sugar', 'creamer', 'tea', 'biscuit', 'snack', 'nescafe', 'dutch lady', 'milk', 'mineral water'],
  'Paper Cup':       ['paper cup', 'disposable cup', '7oz', '9oz'],
  'Paper Plate':     ['paper plate', 'disposable plate'],
}

function categorise(name: string): string | null {
  const lower = name.toLowerCase()
  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    if (kws.some(k => lower.includes(k))) return cat
  }
  return null
}

async function main() {
  console.log('🔍 Reading quotation items from CRM database...\n')

  // Pull all SENT/APPROVED quotation items with product info
  const quotationItems = await prisma.quotationItem.findMany({
    where: {
      quotation: {
        status: { in: ['sent', 'approved', 'accepted'] }
      }
    },
    select: {
      qty:          true,
      unitPrice:    true,
      totalPrice:   true,
      product: {
        select: { name: true, unit: true }
      },
      quotation: {
        select: {
          status:    true,
          createdAt: true,
          company: {
            select: { name: true, id: true }
          }
        }
      }
    },
    orderBy: { quotation: { createdAt: 'asc' } }
  })

  console.log(`Total quotation items (sent/approved/accepted): ${quotationItems.length}`)

  // ── Categorise and aggregate ──
  const catData: Record<string, {
    items: { qty: number; unitPrice: number; productName: string }[]
    totalQty: number
    totalAmt: number
  }> = {}

  const productMatches: { cat: string; name: string; qty: number; price: number }[] = []
  const unmatched = new Set<string>()

  for (const item of quotationItems) {
    const productName = item.product?.name || ''
    const cat = categorise(productName)
    if (!cat) { unmatched.add(productName); continue }

    if (!catData[cat]) catData[cat] = { items: [], totalQty: 0, totalAmt: 0 }
    catData[cat].items.push({ qty: Number(item.qty), unitPrice: Number(item.unitPrice), productName })
    catData[cat].totalQty += Number(item.qty)
    catData[cat].totalAmt += Number(item.totalPrice || 0)
    productMatches.push({ cat, name: productName, qty: Number(item.qty), price: Number(item.unitPrice) })
  }

  // ── Company count for context ──
  const distinctCompanies = new Set(
    quotationItems.map(i => i.quotation?.company?.id).filter(Boolean)
  )
  const dateRange = quotationItems.length > 0 ? {
    from: quotationItems[0].quotation?.createdAt?.toISOString().substring(0, 7),
    to:   quotationItems[quotationItems.length - 1].quotation?.createdAt?.toISOString().substring(0, 7)
  } : null

  console.log(`Companies in data: ${distinctCompanies.size}`)
  if (dateRange) console.log(`Date range: ${dateRange.from} → ${dateRange.to}`)

  // ── Per-company monthly estimates ──
  // Group quotation items by company → month
  const companyMonths: Record<string, { months: Set<string>; catSpend: Record<string, { qty: number; amt: number }> }> = {}

  for (const item of quotationItems) {
    const compId = item.quotation?.company?.id
    const compName = item.quotation?.company?.name || compId || 'unknown'
    const month = item.quotation?.createdAt?.toISOString().substring(0, 7) || ''
    if (!compId || !month) continue

    const cat = categorise(item.product?.name || '')
    if (!cat) continue

    if (!companyMonths[compId]) companyMonths[compId] = { months: new Set(), catSpend: {} }
    companyMonths[compId].months.add(month)
    if (!companyMonths[compId].catSpend[cat]) companyMonths[compId].catSpend[cat] = { qty: 0, amt: 0 }
    companyMonths[compId].catSpend[cat].qty += Number(item.qty)
    companyMonths[compId].catSpend[cat].amt += Number(item.totalPrice || 0)
  }

  // Avg per company-month
  const catAvg: Record<string, { qtyPerMonth: number; amtPerMonth: number; companies: number }> = {}
  for (const [, data] of Object.entries(companyMonths)) {
    const months = data.months.size || 1
    for (const [cat, { qty, amt }] of Object.entries(data.catSpend)) {
      if (!catAvg[cat]) catAvg[cat] = { qtyPerMonth: 0, amtPerMonth: 0, companies: 0 }
      catAvg[cat].qtyPerMonth += qty / months
      catAvg[cat].amtPerMonth += amt / months
      catAvg[cat].companies += 1
    }
  }

  // ── Output ──
  console.log('\n' + '='.repeat(72))
  console.log('  OFFICE SUPPLY USAGE — CRM QUOTATION DATA (all companies)')
  console.log('  Note: averages below are per-company per-month across all companies')
  console.log('='.repeat(72))
  console.log(`  ${'Category'.padEnd(22)} | ${'Avg qty/mth'.padStart(11)} | ${'Avg spend/mth'.padStart(13)} | ${'# cos'}`)
  console.log('-'.repeat(72))

  let totalSpend = 0
  for (const cat of Object.keys(CATEGORIES)) {
    const d = catAvg[cat]
    if (!d) { console.log(`  ${cat.padEnd(22)} | ${'—'.padStart(11)} | ${'—'.padStart(13)} |  no data`); continue }
    const perCo = d.companies
    const avgQty = (d.qtyPerMonth / perCo).toFixed(1)
    const avgAmt = d.amtPerMonth / perCo
    totalSpend += avgAmt
    console.log(`  ${cat.padEnd(22)} | ${avgQty.padStart(11)} | RM ${avgAmt.toFixed(2).padStart(10)} |  ${perCo}`)
  }
  console.log('-'.repeat(72))
  console.log(`  ${'TOTAL (in-scope only)'.padEnd(22)} | ${''.padStart(11)} | RM ${totalSpend.toFixed(2).padStart(10)}`)
  console.log('='.repeat(72))

  // ── Matched products detail ──
  console.log('\n📦 MATCHED PRODUCTS (sample):')
  const bycat: Record<string, string[]> = {}
  for (const m of productMatches) {
    if (!bycat[m.cat]) bycat[m.cat] = []
    if (!bycat[m.cat].includes(m.name)) bycat[m.cat].push(m.name)
  }
  for (const [cat, names] of Object.entries(bycat)) {
    console.log(`  ${cat}:`)
    names.slice(0, 5).forEach(n => console.log(`    • ${n}`))
  }

  if (unmatched.size > 0) {
    console.log(`\n  (${unmatched.size} product types not matched to the 7 categories)`)
  }

  console.log('\n⚠️  This is CRM quotation data only (not full QNE invoice history).')
  console.log('   For complete analysis, connect Radmin VPN and run analyzeOfficeSupplyCost.ts')
}

main().catch(console.error).finally(() => prisma.$disconnect())
