/**
 * Creates realistic office supply order history for "Production testing" company.
 * Since KT Ultimate Advisory has no CRM order history (company was QNE-imported only),
 * this creates representative orders using actual products from the catalogue.
 * Run: npx tsx scripts/_buildRealisticOrders.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const targetCompany = await prisma.company.findFirst({ where: { name: 'Production testing' } })
  if (!targetCompany) { console.log('Production testing not found'); return }

  const dummyUser = await prisma.user.findFirst({ where: { email: 'dummy@test.flexxo' } })
  if (!dummyUser) { console.log('Dummy user not found'); return }

  const admin = await prisma.user.findFirst({ where: { email: 'admin@flexxo.com.my' }, select: { id: true } })
  if (!admin) { console.log('Admin not found'); return }

  // ── Clean previous test orders ─────────────────────────────────────
  const prev = await prisma.order.findMany({ where: { companyId: targetCompany.id } })
  for (const o of prev) {
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
    await prisma.order.delete({ where: { id: o.id } })
  }
  const prevQts = await prisma.quotation.findMany({
    where: { companyId: targetCompany.id, status: { not: 'cart' } },
  })
  for (const q of prevQts) {
    await prisma.quotationItem.deleteMany({ where: { quotationId: q.id } })
    await prisma.quotation.delete({ where: { id: q.id } })
  }
  console.log(`Cleared ${prev.length} old orders, ${prevQts.length} old quotations\n`)

  // ── Search for realistic office supply products ────────────────────
  // Order 1: A4 paper + pens + folders (typical monthly stationery restock)
  // Order 2: Toner + printer paper (quarterly printer supplies)
  // Order 3: Pantry supplies (instant coffee, tissue, cups)

  const findProduct = async (keywords: string[]) => {
    for (const kw of keywords) {
      const p = await prisma.product.findFirst({
        where: {
          name: { contains: kw, mode: 'insensitive' },
          isActive: true,
        },
        include: { priceVersions: { where: { isCurrent: true }, take: 1 } },
      })
      if (p && p.priceVersions.length > 0) return p
    }
    return null
  }

  // Find products for Order 1: stationery
  const a4Paper  = await findProduct(['A4 paper', 'A4 80GSM', 'IK A4', 'APLUS A4', 'A4 COPY'])
  const ballPens = await findProduct(['ball pen', 'ballpen', 'pilot pen', 'FX-5', 'FX5'])
  const folder   = await findProduct(['L-folder', 'L folder', 'clear folder', 'document folder'])
  const stapler  = await findProduct(['stapler', 'MAX STAPLER', 'KOKUYO STAPLER'])
  const scissors = await findProduct(['scissors', 'DELI SCISSORS', 'stationery scissors'])

  // Find products for Order 2: printer supplies
  const toner85a = await findProduct(['HP 85A', 'CE285A', 'toner 85A', '85A toner'])
  const toner12a = await findProduct(['HP 12A', 'Q2612A', 'toner 12A', '12A toner'])
  const inkBlack = await findProduct(['HP 680', 'HP680', 'black ink', 'ink cartridge black'])
  const inkColor = await findProduct(['HP 680 TRI', 'HP680 color', 'colour ink', 'color ink'])

  // Find products for Order 3: pantry
  const coffee   = await findProduct(['NESCAFE', 'instant coffee', 'MILO', '3-in-1'])
  const tissue   = await findProduct(['tissue', 'facial tissue', 'NICE TISSUE', 'kleenex'])
  const cups     = await findProduct(['paper cup', 'plastic cup', 'disposable cup'])
  const handsoap = await findProduct(['hand soap', 'DETTOL', 'handwash', 'liquid soap'])

  const year = new Date().getFullYear()
  let ordNum = await prisma.order.count()
  let qtNum  = await prisma.quotation.count({ where: { status: { not: 'cart' } } })

  // ── Helper: create one order from a product list ───────────────────
  const createOrder = async (
    label: string,
    lines: { product: Awaited<ReturnType<typeof findProduct>>, qty: number }[],
    statusMonthsAgo: number,
  ) => {
    const validLines = lines.filter(l => l.product && l.product.priceVersions.length > 0) as
      { product: NonNullable<Awaited<ReturnType<typeof findProduct>>>; qty: number }[]

    if (validLines.length === 0) {
      console.log(`  [${label}] No matching products found — skipping`)
      return
    }

    qtNum++
    ordNum++
    const refQT  = `QT-${year}-COPY-${String(qtNum).padStart(4, '0')}`
    const refORD = `ORD-${year}-COPY-${String(ordNum).padStart(4, '0')}`

    let subtotal = 0
    const itemData = validLines.map((line, i) => {
      const cost      = parseFloat(line.product.priceVersions[0].costPrice.toString())
      const price     = Math.round(cost * 1.30 * 100) / 100
      const lineTotal = Math.round(price * line.qty * 100) / 100
      subtotal += lineTotal
      return { ...line, cost, price, lineTotal, sortOrder: i }
    })

    const quotation = await prisma.quotation.create({
      data: {
        companyId:     targetCompany.id,
        createdById:   admin.id,
        referenceNo:   refQT,
        status:        'accepted',
        currency:      'MYR',
        versionNumber: 1,
        subtotal,
        totalAmount:   subtotal,
      },
    })

    const qtItems: string[] = []
    for (const row of itemData) {
      const qi = await prisma.quotationItem.create({
        data: {
          quotationId: quotation.id,
          productId:   row.product.id,
          description: row.product.name,
          brand:       row.product.brand ?? null,
          unit:        row.product.unit ?? null,
          qty:         row.qty,
          unitCost:    row.cost,
          unitPrice:   row.price,
          marginPct:   0.30,
          lineTotal:   row.lineTotal,
          sortOrder:   row.sortOrder,
        },
      })
      qtItems.push(qi.id)
    }

    const order = await prisma.order.create({
      data: {
        companyId:   targetCompany.id,
        quotationId: quotation.id,
        createdById: dummyUser.id,
        referenceNo: refORD,
        status:      'delivered',
      },
    })

    for (let i = 0; i < itemData.length; i++) {
      const row = itemData[i]
      await prisma.orderItem.create({
        data: {
          orderId:         order.id,
          productId:       row.product.id,
          quotationItemId: qtItems[i],
          qty:             row.qty,
          unitPrice:       row.price,
          lineTotal:       row.lineTotal,
        },
      })
    }

    console.log(`  ✅ ${label}: ${refORD} — ${validLines.length} items, MYR ${subtotal.toFixed(2)}`)
    validLines.forEach(l => console.log(`     • ${l.product.name} × ${l.qty}`))
    return order
  }

  console.log('Creating 3 realistic orders for Production testing:\n')

  await createOrder('Monthly stationery', [
    { product: a4Paper,  qty: 5 },
    { product: ballPens, qty: 3 },
    { product: folder,   qty: 10 },
    { product: stapler,  qty: 1 },
    { product: scissors, qty: 2 },
  ], 2)

  await createOrder('Printer supplies', [
    { product: toner85a, qty: 2 },
    { product: toner12a, qty: 1 },
    { product: inkBlack, qty: 3 },
    { product: inkColor, qty: 2 },
  ], 1)

  await createOrder('Pantry restock', [
    { product: coffee,   qty: 4 },
    { product: tissue,   qty: 5 },
    { product: cups,     qty: 2 },
    { product: handsoap, qty: 3 },
  ], 0)

  console.log('\n✅ Done. Production testing now has realistic order history.')
  console.log('\n=== TEST REORDER ===')
  console.log('Login: http://localhost:3000/shop/login')
  console.log('Email:    dummy@test.flexxo | Password: Test1234!')
  console.log('Go to /shop/orders and click "Reorder" on any order')
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
