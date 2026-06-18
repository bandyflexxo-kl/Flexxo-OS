import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  // Companies that have at least one order
  const companiesWithOrders = await prisma.company.findMany({
    where: { orders: { some: {} } },
    include: {
      _count: { select: { orders: true } },
      orders: { include: { items: true }, take: 3, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { name: 'asc' },
  })

  console.log(`Companies with CRM orders: ${companiesWithOrders.length}`)
  for (const co of companiesWithOrders) {
    console.log(`\n  ${co.name} (${co._count.orders} orders):`)
    for (const o of co.orders) {
      console.log(`    ${o.referenceNo} | ${o.status} | ${o.items.length} items`)
    }
  }

  // Also count total orders in system
  const totalOrders = await prisma.order.count()
  console.log(`\nTotal orders in CRM: ${totalOrders}`)
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
