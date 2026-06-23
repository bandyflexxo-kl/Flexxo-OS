import { prisma } from '@/lib/prisma'

async function main() {
  // NIKKI brand products
  const nikki = await prisma.product.findMany({
    where: { brand: { contains: 'NIKKI', mode: 'insensitive' } },
    select: { name: true, brand: true, qneItemCode: true, isActive: true, isVisibleToCustomers: true, qneAvailableQty: true },
    take: 20,
  })
  console.log('\n=== NIKKI brand products:', nikki.length, '===')
  for (const p of nikki) console.log(' ', JSON.stringify(p))

  // All 2B pencil products
  const pencils2b = await prisma.product.findMany({
    where: { name: { contains: '2B', mode: 'insensitive' } },
    select: { name: true, brand: true, qneItemCode: true, isActive: true, isVisibleToCustomers: true, qneAvailableQty: true },
    take: 30,
  })
  console.log('\n=== 2B Pencil products (all brands):', pencils2b.length, '===')
  for (const p of pencils2b) console.log(' ', JSON.stringify(p))

  // Search by QNE item code from the screenshot: "NIKKI 119" and "NIKKI 199"
  const byCode = await prisma.product.findMany({
    where: { qneItemCode: { in: ['NIKKI 119', 'NIKKI 199'] } },
    select: { name: true, brand: true, qneItemCode: true, isActive: true, isVisibleToCustomers: true },
  })
  console.log('\n=== Products with code NIKKI 119 or NIKKI 199:', byCode.length, '===')
  for (const p of byCode) console.log(' ', JSON.stringify(p))

  // Check total product count
  const total = await prisma.product.count()
  const active = await prisma.product.count({ where: { isActive: true } })
  console.log(`\n=== Product counts: total=${total}, active=${active} ===`)

  await prisma.$disconnect()
}
main().catch(console.error)
