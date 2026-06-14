import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const cats = await prisma.productCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, parentCategoryId: true, _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  })
  const parents = cats.filter(c => !c.parentCategoryId)
  for (const p of parents) {
    const subs = cats.filter(c => c.parentCategoryId === p.id)
    const subTotal = subs.reduce((a, c) => a + c._count.products, 0)
    console.log(`\n${p.name} [${p.id}] — ${subTotal} products in ${subs.length} sub-cats`)
    for (const s of subs) {
      console.log(`  └ ${s.name}: ${s._count.products}`)
    }
  }
  await prisma.$disconnect()
}
main().catch(console.error)
