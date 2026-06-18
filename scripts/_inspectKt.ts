import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const co = await prisma.company.findFirst({
    where: { name: { contains: 'KT Ultimate', mode: 'insensitive' } },
    include: {
      activities: { orderBy: { createdAt: 'desc' }, take: 5 },
      quotations:  { where: { status: { not: 'cart' } } },
      orders:      { include: { items: true } },
      _count:      { select: { activities: true, quotations: true, orders: true, contacts: true } },
    },
  })
  if (!co) { console.log('KT Ultimate Advisory not found'); return }
  console.log('Company:', co.name)
  console.log('Counts:', co._count)
  console.log('Quotations:', co.quotations.map(q => `${q.referenceNo} (${q.status})`))
  console.log('Orders:', co.orders.map(o => `${o.referenceNo} (${o.status}) — ${o.items.length} items`))
}

main()
  .then(() => { console.log('Done.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
