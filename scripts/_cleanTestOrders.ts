import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const co = await prisma.company.findFirst({ where: { name: 'Production testing' } })
  if (!co) { console.log('Company not found'); return }
  console.log('Company:', co.id)

  const orders = await prisma.order.findMany({ where: { companyId: co.id }, include: { items: true } })
  console.log('Orders found:', orders.length)
  for (const o of orders) {
    console.log(`  Order ${o.referenceNo} (${o.id}) — items: ${o.items.length}`)
    await prisma.order.delete({ where: { id: o.id } })
    console.log(`  Deleted order ${o.referenceNo}`)
  }

  const qts = await prisma.quotation.findMany({ where: { companyId: co.id } })
  console.log('Quotations found:', qts.length)
  for (const q of qts) {
    await prisma.quotationItem.deleteMany({ where: { quotationId: q.id } })
    await prisma.quotation.delete({ where: { id: q.id } })
    console.log(`  Deleted quotation ${q.referenceNo}`)
  }
}

main()
  .then(() => { console.log('Done.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
