/**
 * Duplicates KT Ultimate Advisory's order history into "Production testing"
 * Run: npx tsx scripts/_duplicateKtOrders.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  // ── Find KT Ultimate Advisory ──────────────────────────────────────
  const ktCompany = await prisma.company.findFirst({
    where: { name: { contains: 'KT Ultimate', mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (!ktCompany) { console.log('KT Ultimate Advisory not found'); return }
  console.log('Source company:', ktCompany.name, '(' + ktCompany.id + ')')

  // ── Find Production testing ────────────────────────────────────────
  const targetCompany = await prisma.company.findFirst({
    where: { name: 'Production testing' },
    select: { id: true, name: true },
  })
  if (!targetCompany) { console.log('Production testing company not found'); return }
  console.log('Target company:', targetCompany.name, '(' + targetCompany.id + ')')

  // ── Find Dummy user ────────────────────────────────────────────────
  const dummyUser = await prisma.user.findFirst({
    where: { email: 'dummy@test.flexxo' },
    select: { id: true },
  })
  if (!dummyUser) { console.log('Dummy user not found'); return }
  console.log('Dummy user:', dummyUser.id)

  // ── Load KT's orders ───────────────────────────────────────────────
  const ktOrders = await prisma.order.findMany({
    where:   { companyId: ktCompany.id },
    include: { items: true, quotation: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`\nKT Ultimate Advisory has ${ktOrders.length} order(s):`)
  for (const o of ktOrders) {
    console.log(`  ${o.referenceNo} | status: ${o.status} | items: ${o.items.length}`)
  }

  if (ktOrders.length === 0) {
    // KT has no orders in the CRM — check quotations instead
    const ktQuotations = await prisma.quotation.findMany({
      where:   { companyId: ktCompany.id, status: { not: 'cart' } },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`\nKT Ultimate Advisory has ${ktQuotations.length} quotation(s) instead:`)
    for (const q of ktQuotations) {
      console.log(`  ${q.referenceNo} | status: ${q.status} | items: ${q.items.length}`)
      q.items.forEach(i => console.log(`    - ${i.description} × ${i.qty} @ RM${i.unitPrice}`))
    }
    if (ktQuotations.length === 0) {
      console.log('\nNo orders or quotations found for KT Ultimate Advisory.')
      return
    }
  }

  // ── Clean up existing test data for Production testing ─────────────
  const existingOrders = await prisma.order.findMany({ where: { companyId: targetCompany.id } })
  for (const o of existingOrders) {
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
    await prisma.order.delete({ where: { id: o.id } })
  }
  const existingQts = await prisma.quotation.findMany({
    where: { companyId: targetCompany.id, status: { not: 'cart' } },
  })
  for (const q of existingQts) {
    await prisma.quotationItem.deleteMany({ where: { quotationId: q.id } })
    await prisma.quotation.delete({ where: { id: q.id } })
  }
  console.log(`\nCleared ${existingOrders.length} old test orders and ${existingQts.length} quotations from Production testing`)

  // ── Duplicate each KT order into Production testing ────────────────
  const year   = new Date().getFullYear()
  const ordNum = await prisma.order.count()

  let copied = 0
  for (let i = 0; i < ktOrders.length; i++) {
    const src = ktOrders[i]

    // Duplicate the linked quotation first (if any)
    let newQuotation = null
    if (src.quotation) {
      const qtItems = await prisma.quotationItem.findMany({
        where: { quotationId: src.quotation.id },
      })
      const qtCount = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
      newQuotation = await prisma.quotation.create({
        data: {
          companyId:     targetCompany.id,
          createdById:   dummyUser.id,
          referenceNo:   `QT-${year}-COPY-${String(qtCount + 1).padStart(4, '0')}`,
          status:        src.quotation.status,
          currency:      src.quotation.currency,
          versionNumber: 1,
          subtotal:      Number(src.quotation.subtotal?.toString() ?? 0),
          totalAmount:   Number(src.quotation.totalAmount?.toString() ?? 0),
          notes:         src.quotation.notes ?? null,
        },
      })
      for (let j = 0; j < qtItems.length; j++) {
        const qi = qtItems[j]
        await prisma.quotationItem.create({
          data: {
            quotationId: newQuotation.id,
            productId:   qi.productId ?? null,
            description: qi.description,
            brand:       qi.brand ?? null,
            unit:        qi.unit ?? null,
            qty:         Number(qi.qty.toString()),
            unitCost:    Number(qi.unitCost.toString()),
            unitPrice:   Number(qi.unitPrice.toString()),
            marginPct:   Number(qi.marginPct.toString()),
            lineTotal:   Number(qi.lineTotal.toString()),
            sortOrder:   j,
          },
        })
      }
    }

    // Duplicate the order
    const newOrder = await prisma.order.create({
      data: {
        companyId:       targetCompany.id,
        quotationId:     newQuotation?.id ?? null,
        createdById:     dummyUser.id,
        referenceNo:     `ORD-${year}-COPY-${String(ordNum + i + 1).padStart(4, '0')}`,
        status:          src.status,
        customerPoNumber: src.customerPoNumber ?? null,
      },
    })

    // Duplicate order items
    for (const item of src.items) {
      await prisma.orderItem.create({
        data: {
          orderId:   newOrder.id,
          productId: item.productId ?? null,
          qty:       Number(item.qty.toString()),
          unitPrice: Number(item.unitPrice.toString()),
          lineTotal: Number(item.lineTotal.toString()),
        },
      })
    }

    console.log(`  Copied: ${src.referenceNo} → ${newOrder.referenceNo} (${src.items.length} items)`)
    copied++
  }

  console.log(`\n✅ Duplicated ${copied} order(s) from KT Ultimate Advisory into Production testing`)
  console.log('\n=== READY TO TEST REORDER ===')
  console.log('Login: http://localhost:3000/shop/login')
  console.log('Email:    dummy@test.flexxo')
  console.log('Password: Test1234!')
  console.log('Go to /shop/orders and click "Reorder" on any order')
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
