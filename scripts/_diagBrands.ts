import { prisma } from '@/lib/prisma'

async function main() {
  const wb = await prisma.product.findMany({
    where: { name: { contains: 'whiteboard', mode: 'insensitive' }, isActive: true },
    select: { name: true, brand: true },
    take: 8,
  })
  console.log('=== Whiteboard products ===')
  for (const p of wb) console.log(' ', JSON.stringify(p.brand), '|', p.name)

  const af = await prisma.product.findMany({
    where: { name: { contains: 'arch file', mode: 'insensitive' }, isActive: true },
    select: { name: true, brand: true },
    take: 10,
  })
  console.log('\n=== Arch File products ===')
  for (const p of af) console.log(' ', JSON.stringify(p.brand), '|', p.name)

  const bp = await prisma.product.findMany({
    where: { name: { contains: 'ball pen', mode: 'insensitive' }, isActive: true },
    select: { name: true, brand: true },
    orderBy: { qneInvoiceFreq: 'desc' },
    take: 10,
  })
  console.log('\n=== Ball Pen products (by freq) ===')
  for (const p of bp) console.log(' ', JSON.stringify(p.brand), '|', p.name)

  await prisma.$disconnect()
}
main().catch(console.error)
