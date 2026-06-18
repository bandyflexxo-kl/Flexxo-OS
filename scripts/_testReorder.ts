/**
 * Test reorder setup: creates dummy company + B2B user + test order
 * Run: npx tsx scripts/_testReorder.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const bcrypt     = await import('bcryptjs')

  // ── Admin user (needed as createdById) ──────────────────────────
  const admin = await prisma.user.findFirst({
    where:  { email: 'admin@flexxo.com.my' },
    select: { id: true },
  })
  if (!admin) { console.log('Admin user not found'); return }
  console.log('Admin ID:', admin.id)

  // ── Company: Production testing ──────────────────────────────────
  let co = await prisma.company.findFirst({ where: { name: 'Production testing' } })
  if (!co) {
    co = await prisma.company.create({
      data: {
        name:           'Production testing',
        nameNormalized: 'production testing',
        status:         'active',
        createdById:    admin.id,
      },
    })
    console.log('Created company:', co.name, co.id)
  } else {
    console.log('Company exists:', co.name, co.id)
  }

  // ── B2B Client user: Dummy ───────────────────────────────────────
  const b2bRole = await prisma.role.findFirst({ where: { name: 'B2B Client' } })
  if (!b2bRole) { console.log('B2B Client role not found'); return }

  let dummyUser = await prisma.user.findFirst({ where: { email: 'dummy@test.flexxo' } })
  if (!dummyUser) {
    const hash = await bcrypt.hash('Test1234!', 10)
    dummyUser = await prisma.user.create({
      data: {
        name:              'Dummy',
        email:             'dummy@test.flexxo',
        passwordHash:      hash,
        isActive:          true,
        customerCompanyId: co.id,
        userRoles:         { create: { roleId: b2bRole.id } },
      },
    })
    console.log('Created user: Dummy | email: dummy@test.flexxo | pass: Test1234!')
  } else {
    // Make sure user is linked to production testing company
    if (dummyUser.customerCompanyId !== co.id) {
      await prisma.user.update({ where: { id: dummyUser.id }, data: { customerCompanyId: co.id } })
      console.log('Updated user company link')
    }
    console.log('User exists:', dummyUser.name, dummyUser.id)
  }

  // ── Source items: pick 5 stocked products ────────────────────────
  const products = await prisma.product.findMany({
    where:   { isActive: true, isVisibleToCustomers: true },
    include: { priceVersions: { where: { isCurrent: true }, take: 1 } },
    take:    10,
    orderBy: { name: 'asc' },
  })
  // Only products that have a current price version
  const priced = products.filter(p => p.priceVersions.length > 0).slice(0, 5)
  console.log(`\nSource products for test order (${priced.length}):`)
  priced.forEach(p => console.log(`  - ${p.name} | price: ${p.priceVersions[0].costPrice.toString()}`))

  if (priced.length === 0) {
    console.log('No priced products found — cannot create order')
    return
  }

  // ── Check if test order already exists ───────────────────────────
  const existingOrder = await prisma.order.findFirst({
    where: { companyId: co.id },
    include: { items: true },
  })
  if (existingOrder) {
    console.log(`\nTest order already exists: ${existingOrder.referenceNo} (${existingOrder.id})`)
    console.log(`Items: ${existingOrder.items.length}`)
    console.log('\n=== READY TO TEST ===')
    console.log('Login at: http://localhost:3000/shop/login')
    console.log('Email:    dummy@test.flexxo')
    console.log('Password: Test1234!')
    console.log('Then go to /shop/orders and click "Reorder"')
    console.log(`Order ID: ${existingOrder.id}`)
    return
  }

  // ── Create quotation + order + order items ────────────────────────
  const year   = new Date().getFullYear()
  const qtNum  = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  const refNo  = `QT-${year}-TEST-${String(qtNum + 1).padStart(4, '0')}`

  let subtotal = 0
  const itemData = priced.map((p, i) => {
    const cost      = Number(p.priceVersions[0].costPrice.toString())
    const price     = Math.round(cost * 1.3 * 100) / 100
    const qty       = 2
    const lineTotal = price * qty
    subtotal += lineTotal
    return { product: p, qty, cost, price, lineTotal, sortOrder: i }
  })

  const quotation = await prisma.quotation.create({
    data: {
      companyId:     co.id,
      createdById:   dummyUser.id,
      referenceNo:   refNo,
      status:        'accepted',
      currency:      'MYR',
      versionNumber: 1,
      subtotal,
      totalAmount:   subtotal,
    },
  })

  const qtItems: { id: string }[] = []
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
        lineTotal:   row.lineTotal,
        sortOrder:   row.sortOrder,
      },
    })
    qtItems.push(qi)
  }

  const ordNum  = await prisma.order.count()
  const order   = await prisma.order.create({
    data: {
      companyId:    co.id,
      quotationId:  quotation.id,
      createdById:  dummyUser.id,
      referenceNo:  `ORD-${year}-TEST-${String(ordNum + 1).padStart(4, '0')}`,
      status:       'delivered',
    },
  })

  for (let i = 0; i < itemData.length; i++) {
    const row = itemData[i]
    await prisma.orderItem.create({
      data: {
        orderId:         order.id,
        productId:       row.product.id,
        quotationItemId: qtItems[i].id,
        qty:             row.qty,
        unitPrice:       row.price,
        lineTotal:       row.lineTotal,
      },
    })
  }

  console.log(`\nCreated quotation: ${quotation.referenceNo}`)
  console.log(`Created order: ${order.referenceNo} (${order.id})`)
  console.log(`Total: MYR ${subtotal.toFixed(2)}`)
  console.log('\n=== READY TO TEST ===')
  console.log('Login at: http://localhost:3000/shop/login')
  console.log('Email:    dummy@test.flexxo')
  console.log('Password: Test1234!')
  console.log('Then go to /shop/orders and click "Reorder"')
  console.log(`Order ID: ${order.id}`)
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
