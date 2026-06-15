import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      category: { slug: { in: ['br--beverages', 'br--snacks-food', 'br--general'] } },
    },
    select: { name: true, category: { select: { slug: true } } },
    orderBy: { name: 'asc' },
  })

  console.log('Total in Breakroom sub-cats:', rows.length)

  const bev   = rows.filter(r => r.category.slug === 'br--beverages')
  const snack = rows.filter(r => r.category.slug === 'br--snacks-food')
  const gen   = rows.filter(r => r.category.slug === 'br--general')

  console.log(`\n--- Beverages (${bev.length}) ---`)
  bev.forEach(r => console.log(' ', r.name))

  console.log(`\n--- Snacks & Food (${snack.length}) ---`)
  snack.forEach(r => console.log(' ', r.name))

  console.log(`\n--- General Breakroom (${gen.length}) ---`)
  gen.forEach(r => console.log(' ', r.name))

  await prisma.$disconnect()
}
main().catch(e => { console.error(e.message); process.exit(1) })
