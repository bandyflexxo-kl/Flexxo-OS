import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const parentCats = await prisma.productCategory.findMany({
    where: { isActive: true, parentCategoryId: null },
    select: { name: true, slug: true, _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  })

  console.log('=== Products in PARENT categories (goal: all 0) ===')
  let totalInParents = 0
  for (const c of parentCats) {
    const flag = c._count.products > 0 ? ' ⚠️  STILL HAS PRODUCTS' : ' ✓'
    console.log(`  ${c.name} (${c.slug}): ${c._count.products}${flag}`)
    totalInParents += c._count.products
  }
  console.log(`\n  Total in parent categories: ${totalInParents}`)

  const inSubs = await prisma.product.count({
    where: { isActive: true, category: { parentCategoryId: { not: null } } },
  })
  const total = await prisma.product.count({ where: { isActive: true } })
  console.log(`\n  Products in sub-categories: ${inSubs} / ${total}`)
  console.log(`  ` + (inSubs === total ? '✅ ALL products are in sub-categories!' : `⚠️  ${total - inSubs} products NOT in sub-categories`))

  await prisma.$disconnect()
}
main().catch(console.error)
