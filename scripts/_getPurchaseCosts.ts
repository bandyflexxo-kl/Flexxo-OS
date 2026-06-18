/**
 * Pull current approved purchase costs (SupplierPriceVersion.costPrice where isCurrent=true)
 * for the 11 subscription categories, grouped by keyword match on product name.
 */
import { prisma } from '@/lib/prisma'

// Each entry: [required substring(s), optional excludes]
// Match = ALL includes present, NONE of excludes present
const CATEGORIES: Record<string, { includes: string[]; excludes?: string[] }> = {
  'A4 Paper':        { includes: ['a4'], excludes: ['envelope', 'pocket', 'folder', 'file', 'board', 'lamina', 'label', 'frame', 'photo', 'cover', 'bag', 'display', 'protector', 'sleeve', 'sheet metal', 'sticker', 'transfer'] },
  'Cartridge / Ink': { includes: ['cartridge'], excludes: ['staple', 'tape', 'ribbon'] },
  'Ball Pen':        { includes: ['ball pen'] },
  'Correction Tape': { includes: ['correction tape'] },
  'Arch File':       { includes: ['arch file'] },
  'Coffee Powder':   { includes: ['coffee'], excludes: ['table', 'chair', 'stool', 'cabinet', 'rack', 'machine', 'maker', 'brewer', 'mug', 'cup', 'pot', 'grinder'] },
  'Milo Powder':     { includes: ['milo'] },
  'Teabag':          { includes: ['tea bag'] },
  'Biscuit':         { includes: ['biscuit'] },
  'Paper Cup':       { includes: ['paper cup'] },
  'Tissue Roll':     { includes: ['tissue roll'] },
}

async function main() {
  const versions = await prisma.supplierPriceVersion.findMany({
    where: { isCurrent: true },
    select: {
      costPrice: true,
      unit:      true,
      product:   { select: { name: true, unit: true } },
    },
  })

  console.log(`Total current price versions: ${versions.length}\n`)

  const results: Record<string, { prices: number[]; samples: string[] }> = {}

  for (const v of versions) {
    const name  = (v.product?.name || '').toLowerCase()
    const price = Number(v.costPrice)
    if (price <= 0) continue

    for (const [cat, rule] of Object.entries(CATEGORIES)) {
      const allInclude = rule.includes.every(k => name.includes(k))
      const anyExclude = rule.excludes?.some(k => name.includes(k)) ?? false
      if (allInclude && !anyExclude) {
        if (!results[cat]) results[cat] = { prices: [], samples: [] }
        results[cat].prices.push(price)
        if (results[cat].samples.length < 4) results[cat].samples.push(`RM ${price.toFixed(2)}  ${v.product.name}`)
        break
      }
    }
  }

  console.log('='.repeat(60))
  console.log('  PURCHASE COSTS FROM SUPPLIER PRICE DATABASE')
  console.log('='.repeat(60))

  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    const d = results[cat]
    if (!d || d.prices.length === 0) {
      console.log(`  ${cat.padEnd(22)} — no data in supplier price DB`)
      continue
    }
    const avg = d.prices.reduce((a,b)=>a+b,0) / d.prices.length
    const min = Math.min(...d.prices)
    const max = Math.max(...d.prices)
    console.log(`  ${cat.padEnd(22)} avg RM ${avg.toFixed(2)}  (min ${min.toFixed(2)} – max ${max.toFixed(2)}, n=${d.prices.length})`)
    d.samples.forEach(s => console.log(`      • ${s}`))
  }
  console.log('='.repeat(60))
}

main().catch(console.error).finally(() => prisma.$disconnect())
