/**
 * Test reorder business logic directly (without HTTP session).
 * Replicates exactly what POST /api/portal/orders/[id]/reorder does.
 * Run: npx tsx scripts/_testReorderLogic.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  // ── 1. Find the test order for "Production testing" ───────────────
  const dummyUser = await prisma.user.findFirst({
    where: { email: 'dummy@test.flexxo' },
    select: { id: true, customerCompanyId: true },
  })
  if (!dummyUser || !dummyUser.customerCompanyId) {
    console.log('Dummy user not found or no company linked'); return
  }
  console.log('Dummy user:', dummyUser.id)
  console.log('Company:', dummyUser.customerCompanyId)

  const order = await prisma.order.findFirst({
    where: { companyId: dummyUser.customerCompanyId },
    include: {
      items: {
        include: { product: { include: { priceVersions: { where: { isCurrent: true }, take: 1 } } } },
      },
    },
  })
  if (!order) { console.log('No test order found'); return }
  console.log(`\nTest order: ${order.referenceNo} (${order.id})`)
  console.log(`Items: ${order.items.length}`)
  order.items.forEach(item => {
    console.log(`  - ${item.product?.name ?? 'Unknown'} × ${item.qty} @ RM${item.unitPrice}`)
  })

  // ── 2. Read global margin setting ─────────────────────────────────
  const marginSetting = await prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } })
  const globalMargin = marginSetting ? parseFloat(marginSetting.value) : 30

  // ── 3. Delete existing cart for this user (so we can reorder clean) ─
  const existingCart = await prisma.quotation.findFirst({
    where: { createdById: dummyUser.id, status: 'cart' },
  })
  if (existingCart) {
    await prisma.quotationItem.deleteMany({ where: { quotationId: existingCart.id } })
    await prisma.quotation.delete({ where: { id: existingCart.id } })
    console.log('\nCleared existing cart quotation')
  }

  // ── 4. Replicate reorder logic from the API route ─────────────────
  // Find or create cart quotation
  let cartQuotation = await prisma.quotation.findFirst({
    where: { companyId: dummyUser.customerCompanyId, createdById: dummyUser.id, status: 'cart' },
  })
  if (!cartQuotation) {
    cartQuotation = await prisma.quotation.create({
      data: {
        companyId:     dummyUser.customerCompanyId,
        createdById:   dummyUser.id,
        status:        'cart',
        currency:      'MYR',
        versionNumber: 1,
        referenceNo:   `CART-${dummyUser.id.slice(0, 8)}`,
      },
    })
    console.log(`Created cart: ${cartQuotation.id}`)
  }

  let added = 0
  let skipped = 0

  for (const item of order.items) {
    if (!item.productId || !item.product) { skipped++; continue }

    const priceVersion = item.product.priceVersions[0]
    if (!priceVersion) { skipped++; continue }

    const costPrice    = parseFloat(priceVersion.costPrice.toString())
    const productMargin = item.product.marginPct ? parseFloat(item.product.marginPct.toString()) : null
    const margin       = productMargin ?? globalMargin
    const unitPrice    = Math.round(costPrice * (1 + margin / 100) * 100) / 100
    const qty          = parseFloat(item.qty.toString())
    const lineTotal    = Math.round(unitPrice * qty * 100) / 100

    // Upsert: if product already in cart increase qty; else create
    const existing = await prisma.quotationItem.findFirst({
      where: { quotationId: cartQuotation.id, productId: item.productId },
    })
    if (existing) {
      const newQty      = parseFloat(existing.qty.toString()) + qty
      const newLineTotal = Math.round(parseFloat(existing.unitPrice.toString()) * newQty * 100) / 100
      await prisma.quotationItem.update({
        where: { id: existing.id },
        data:  { qty: newQty, lineTotal: newLineTotal },
      })
    } else {
      await prisma.quotationItem.create({
        data: {
          quotationId: cartQuotation.id,
          productId:   item.productId,
          description: item.product.name,
          brand:       item.product.brand ?? null,
          unit:        item.product.unit ?? null,
          qty,
          unitCost:    costPrice,
          unitPrice,
          marginPct:   margin / 100,
          lineTotal,
          sortOrder:   added,
        },
      })
    }
    added++
    console.log(`  Added: ${item.product.name} × ${qty} @ RM${unitPrice} = RM${lineTotal}`)
  }

  // Update cart subtotal
  const cartItems = await prisma.quotationItem.findMany({ where: { quotationId: cartQuotation.id } })
  const subtotal  = cartItems.reduce((sum, ci) => sum + parseFloat(ci.lineTotal.toString()), 0)
  await prisma.quotation.update({
    where: { id: cartQuotation.id },
    data:  { subtotal, totalAmount: subtotal },
  })

  console.log(`\n✅ Reorder complete!`)
  console.log(`   Added: ${added} items`)
  console.log(`   Skipped: ${skipped} items`)
  console.log(`   Cart total: MYR ${subtotal.toFixed(2)}`)
  console.log(`   Cart quotation ID: ${cartQuotation.id}`)
  console.log(`\nNow log in at: http://localhost:3000/shop/login`)
  console.log(`Email:    dummy@test.flexxo`)
  console.log(`Password: Test1234!`)
  console.log(`Then go to /shop/orders → click "Reorder" to trigger via UI`)
  console.log(`Or check /shop/cart to see the pre-built cart above`)
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
