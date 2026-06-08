import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')

  const total   = await prisma.product.count({ where: { isActive: true } })
  const visible = await prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true } })
  const aplusAll = await prisma.product.count({ where: { isActive: true, brand: { contains: 'APLUS', mode: 'insensitive' } } })
  const aplusVis = await prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true, brand: { contains: 'APLUS', mode: 'insensitive' } } })

  console.log('Total active products:', total)
  console.log('Visible to customers:', visible)
  console.log('APLUS (all active):', aplusAll)
  console.log('APLUS (visible):', aplusVis)

  const topOrdered = await prisma.quotationItem.groupBy({
    by: ['productId'],
    where: { productId: { not: null }, quotation: { status: { not: 'cart' } } },
    _count: { productId: true },
    orderBy: { _count: { productId: 'desc' } },
    take: 15,
  })

  console.log('\nTop 15 most quoted products:')
  for (const item of topOrdered) {
    if (!item.productId) continue
    const p = await prisma.product.findUnique({
      where:  { id: item.productId },
      select: { name: true, brand: true, isVisibleToCustomers: true },
    })
    console.log(` ${String(item._count.productId).padStart(3)}x  [${p?.isVisibleToCustomers ? 'VIS' : '   '}]  ${p?.brand?.padEnd(20) ?? ''.padEnd(20)}  ${p?.name}`)
  }

  // Sample APLUS products
  const aplusSample = await prisma.product.findMany({
    where:   { isActive: true, isVisibleToCustomers: true, brand: { contains: 'APLUS', mode: 'insensitive' } },
    select:  { name: true, brand: true },
    orderBy: { name: 'asc' },
    take:    20,
  })
  console.log('\nSample APLUS visible products:')
  aplusSample.forEach(p => console.log('  ', p.name))

  await prisma.$disconnect()
}
main().catch(console.error)
