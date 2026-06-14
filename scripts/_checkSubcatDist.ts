import { prisma } from '@/lib/prisma'

async function main() {
  // Check products assigned directly to PARENT categories (should be 0)
  const parents = await prisma.productCategory.findMany({
    where: { isActive: true, parentCategoryId: null },
    select: { id: true, name: true, slug: true, _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  })

  console.log('\n=== Products in PARENT categories (should all be 0) ===')
  let totalInParents = 0
  for (const p of parents) {
    const count = p._count.products
    totalInParents += count
    const flag = count > 0 ? ' ⚠️  NEEDS FIXING' : ' ✓'
    console.log(`  ${p.name}: ${count}${flag}`)
  }
  console.log(`  Total in parents: ${totalInParents}`)

  // Check sub-categories and their product counts
  const subs = await prisma.productCategory.findMany({
    where: { isActive: true, parentCategoryId: { not: null } },
    select: {
      id: true, name: true, slug: true,
      parent: { select: { name: true } },
      _count: { select: { products: true } },
    },
    orderBy: [{ parent: { name: 'asc' } }, { name: 'asc' }],
  })

  console.log('\n=== Sub-category product counts ===')
  let currentParent = ''
  let totalInSubs = 0
  for (const s of subs) {
    const parentName = s.parent?.name ?? '(no parent)'
    if (parentName !== currentParent) {
      currentParent = parentName
      console.log(`\n  [${parentName}]`)
    }
    const count = s._count.products
    totalInSubs += count
    const flag = count === 0 ? ' ← EMPTY' : ''
    console.log(`    ${s.name}: ${count}${flag}`)
  }
  console.log(`\n  Total in sub-categories: ${totalInSubs}`)

  // Products with no category at all
  const total = await prisma.product.count({ where: { isActive: true } })
  const withCat = await prisma.product.count({ where: { isActive: true, categoryId: { not: null } } })
  console.log(`\n  Total active products: ${total}`)
  console.log(`  With category: ${withCat}`)
  console.log(`  Without category: ${total - withCat}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
