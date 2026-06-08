/**
 * scripts/testSmartOrder.ts
 *
 * Tests the Smart Order matching engine against the 38-item client list.
 * Also creates a draft quotation with matched items in the DB.
 *
 * Usage: npx tsx scripts/testSmartOrder.ts
 * Usage (no quotation): npx tsx scripts/testSmartOrder.ts --match-only
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local BEFORE any Prisma/lib imports
config({ path: resolve(process.cwd(), '.env.local') })

const ITEM_LIST = `
Faber Castel Gel Pen RX Blue x 1 box
Faber Castel Gel Pen RX Red x 1 box
Faber Castel Gel Pen RX Black x 1 box
Faber Castel Mechanical Pencil x 1
Mechanical Pencils Lead x 1
Pencil x 1
Eraser x 1
Artline Whiteboard Marker red bullet tip x 1
Artline Whiteboard Marker blue bullet tip x 1
Artline Whiteboard Marker black bullet tip x 1
Artline Permanent Marker red bullet tip x 1
Artline Permanent Marker blue bullet tip x 1
Artline Permanent Marker black bullet tip x 1
Faber Castel Highlighter x 1
Plastic Ruler 15cm x 1
Plastic Ruler 30cm x 1
Correction Tape x 1
Light Duty Scissors x 1
Binder Clip 15mm x 1
Binder Clip 32mm x 1
Binder Clip 51mm x 1
Clip 31mm x 1
Clip Jumbo x 1
Anti Slip Tape x 1
Double Side Tape 18mm x 1
Masking Tape 48mm x 1
Cloth Tape 48mm x 1
Loytape 18mm x 1
Loytape 48mm x 1
Tack It x 1
Film Roll x 1
Glue Stick x 1
Light Duty Cutter x 1
Paperone A4 75gsm x 1 ream
Sticky Note 1.5x2 x 1
Sticky Note 3x3 x 1
Sticky Note 3x5 x 1
A4 White Label Sticker x 1
Arch File 2 inch x 1
Arch File 3 inch x 1
A4 Clear Folder L Shape x 1
Refill Transparent Pocket Holder x 1
Envelope Peel Seal 4x9 x 1
Envelope Peel Seal 9x12 x 1
Envelope Peel Seal 10x15 x 1
Stapler HD-10 x 1
Stapler HD-50 x 1
Heavy Duty Stapler 100 sheets x 1
Staples No10 x 1
Puncher DP480 x 1
Puncher DP700 x 1
Calculator x 1
Non Smoking Sign x 1
Whiteboard Duster x 1
Laminating Film A4 x 1
Battery AA x 1
Battery AAA x 1
`.trim()

const matchOnly = process.argv.includes('--match-only')

async function main() {
  // Dynamic imports so Prisma + Decimal are instantiated AFTER env is loaded
  const { prisma }                              = await import('../lib/prisma')
  const { Prisma }                              = await import('../app/generated/prisma/client')
  const { parseItemList, matchProductsForLines } = await import('../lib/smartOrder')

  function calcSellingPrice(
    cost:    InstanceType<typeof Prisma.Decimal>,
    pMargin: InstanceType<typeof Prisma.Decimal> | null,
    cMargin: InstanceType<typeof Prisma.Decimal> | null,
    gm:      string,
  ): InstanceType<typeof Prisma.Decimal> {
    const margin = pMargin ?? cMargin ?? new Prisma.Decimal(gm)
    return cost.times(new Prisma.Decimal(1).plus(margin.dividedBy(100))).toDecimalPlaces(2)
  }

  console.log('=== SMART ORDER — MATCH TEST ===\n')
  console.log(`Parsing ${ITEM_LIST.split('\n').length} lines...\n`)

  const lines   = parseItemList(ITEM_LIST)
  const matched = await matchProductsForLines(lines)

  // ── Print results ───────────────────────────────────────────────────────────

  let highCount   = 0
  let mediumCount = 0
  let noneCount   = 0

  console.log('─'.repeat(110))
  console.log(
    'CONFIDENCE'.padEnd(12),
    'PARSED NAME'.padEnd(40),
    'BEST MATCH'.padEnd(38),
    'SCORE'.padEnd(7),
    'PRICE (MYR)',
  )
  console.log('─'.repeat(110))

  for (const m of matched) {
    const conf = m.confidence === 'high' ? '✅ HIGH' : m.confidence === 'medium' ? '⚠ MEDIUM' : '❌ NONE'
    const topName  = m.topMatch ? m.topMatch.name.substring(0, 37) : '(no match)'
    const topScore = m.topMatch ? m.topMatch.score.toFixed(2) : '—'
    const topPrice = m.topMatch?.sellingPrice ? `MYR ${Number(m.topMatch.sellingPrice).toFixed(2)}` : '—'

    console.log(
      conf.padEnd(12),
      m.parsedName.substring(0, 39).padEnd(40),
      topName.padEnd(38),
      topScore.padEnd(7),
      topPrice,
    )

    if (m.confidence === 'high')   highCount++
    else if (m.confidence === 'medium') mediumCount++
    else noneCount++
  }

  console.log('─'.repeat(110))
  console.log(`\nSUMMARY: ${highCount} auto-matched ✅  |  ${mediumCount} needs review ⚠  |  ${noneCount} not found ❌`)
  console.log(`Total: ${matched.length} items\n`)

  // Show alternatives for medium-confidence items
  const mediumItems = matched.filter(m => m.confidence === 'medium')
  if (mediumItems.length > 0) {
    console.log('\n── MEDIUM CONFIDENCE — Top 3 alternatives ──')
    for (const m of mediumItems) {
      console.log(`\n  "${m.parsedName}":`)
      m.alternatives.slice(0, 3).forEach((alt, i) => {
        console.log(`    ${i + 1}. ${alt.name} (${alt.brand ?? 'no brand'}) — score ${alt.score.toFixed(2)} — ${alt.sellingPrice ? `MYR ${Number(alt.sellingPrice).toFixed(2)}` : 'no price'}`)
      })
    }
  }

  // Show none items
  const noneItems = matched.filter(m => m.confidence === 'none')
  if (noneItems.length > 0) {
    console.log('\n── NOT FOUND — will be added as free-text ──')
    noneItems.forEach(m => console.log(`  • ${m.parsedName}`))
  }

  if (matchOnly) {
    await prisma.$disconnect()
    return
  }

  // ── Create draft quotation ──────────────────────────────────────────────────

  console.log('\n\n=== CREATING DRAFT QUOTATION ===\n')

  const admin = await prisma.user.findFirst({
    where:  { email: 'admin@flexxo.com.my' },
    select: { id: true },
  })
  if (!admin) { console.log('Admin user not found'); await prisma.$disconnect(); return }

  // Use the first company in the DB as test
  const company = await prisma.company.findFirst({
    orderBy: { name: 'asc' },
    select:  { id: true, name: true },
  })
  if (!company) { console.log('No company found in DB'); await prisma.$disconnect(); return }

  console.log(`Creating quotation for: ${company.name}`)

  // Generate reference number
  const year     = new Date().getFullYear()
  const last     = await prisma.quotation.findFirst({ orderBy: { createdAt: 'desc' }, select: { referenceNo: true } })
  const lastNum  = last ? parseInt(last.referenceNo.replace(/\D/g, '').slice(-4)) || 0 : 0
  const refNo    = `QT-${year}-${String(lastNum + 1).padStart(4, '0')}`

  const quotation = await prisma.quotation.create({
    data: {
      referenceNo: refNo,
      status:      'draft',
      currency:    'MYR',
      companyId:   company.id,
      createdById: admin.id,
    },
  })

  console.log(`Created quotation: ${quotation.referenceNo} (ID: ${quotation.id})`)

  // Add matched items
  let addedCount   = 0
  let skippedCount = 0
  const [globalSetting] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
  ])
  const globalMargin = globalSetting?.value ?? '30'

  for (let i = 0; i < matched.length; i++) {
    const m = matched[i]

    if (m.topMatch) {
      // Fetch latest supplier price for this product
      const priceVersion = await prisma.supplierPriceVersion.findFirst({
        where:   { productId: m.topMatch.id, isCurrent: true },
        orderBy: { approvedAt: 'desc' },
        select:  { id: true, costPrice: true, currency: true },
      })

      const product = await prisma.product.findUnique({
        where:  { id: m.topMatch.id },
        select: { defaultMarginPct: true, category: { select: { defaultMarginPct: true } } },
      })

      let unitPrice = 0
      let unitCost: string | null = null
      let marginPct: string | null = null

      if (priceVersion && product) {
        const selling = calcSellingPrice(
          priceVersion.costPrice,
          product.defaultMarginPct,
          product.category.defaultMarginPct,
          globalMargin,
        )
        unitPrice = Number(selling.toString())
        unitCost  = priceVersion.costPrice.toString()
        const margin = priceVersion.costPrice.gt(0)
          ? selling.minus(priceVersion.costPrice).dividedBy(priceVersion.costPrice).times(100)
          : null
        marginPct = margin ? margin.toDecimalPlaces(2).toString() : null
      }

      if (unitPrice <= 0) {
        // No price — still add as free-text line with 0 price placeholder
        await prisma.quotationItem.create({
          data: {
            quotationId:  quotation.id,
            productId:    m.topMatch.id,
            description:  m.topMatch.name,
            brand:        m.topMatch.brand,
            unit:         m.topMatch.unit ?? m.unit,
            qty:          m.qty,
            unitCost:     null,
            unitPrice:    0,
            lineTotal:    0,
            sortOrder:    i,
          },
        })
      } else {
        await prisma.quotationItem.create({
          data: {
            quotationId:            quotation.id,
            productId:              m.topMatch.id,
            supplierPriceVersionId: priceVersion?.id,
            description:            m.topMatch.name,
            brand:                  m.topMatch.brand,
            unit:                   m.topMatch.unit ?? m.unit,
            qty:                    m.qty,
            unitCost,
            unitPrice,
            lineTotal:              unitPrice * m.qty,
            marginPct,
            sortOrder:              i,
          },
        })
      }
      addedCount++
    } else {
      // No match — add as free-text placeholder
      await prisma.quotationItem.create({
        data: {
          quotationId: quotation.id,
          description: m.parsedName,
          unit:        m.unit,
          qty:         m.qty,
          unitCost:    null,
          unitPrice:   0,
          lineTotal:   0,
          sortOrder:   i,
        },
      })
      addedCount++
      skippedCount++
    }
  }

  // Update quotation totals
  const items = await prisma.quotationItem.findMany({ where: { quotationId: quotation.id } })
  const subtotal = items.reduce((s, it) => s + Number(it.lineTotal), 0)
  await prisma.quotation.update({
    where: { id: quotation.id },
    data: { subtotal, totalAmount: subtotal },
  })

  console.log(`\nAdded ${addedCount} items (${skippedCount} as no-price placeholders)`)
  console.log(`Subtotal: MYR ${subtotal.toFixed(2)}`)
  console.log(`\n✅ Draft quotation ready: ${refNo}`)
  console.log(`   Open in CRM: http://localhost:3000/quotations/${quotation.id}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
