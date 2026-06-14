/**
 * scripts/listCategories.ts
 * Prints current product categories with product counts.
 * Run: npx tsx scripts/listCategories.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const cats = await prisma.productCategory.findMany({
    select: { name: true, _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  })
  console.log('── Current categories ──')
  for (const c of cats) console.log(`${c.name.padEnd(30)} ${c._count.products}`)

  const total   = await prisma.product.count({ where: { isActive: true } })
  const visible = await prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true } })
  console.log(`\nTotal active: ${total} | Visible to customers: ${visible}`)

  // Sample of product names per category to understand contents
  console.log('\n── Sample products per category ──')
  const full = await prisma.productCategory.findMany({
    select: {
      name: true,
      products: { where: { isActive: true }, take: 8, select: { name: true }, orderBy: { name: 'asc' } },
    },
    orderBy: { name: 'asc' },
  })
  for (const c of full) {
    console.log(`\n[${c.name}]`)
    for (const p of c.products) console.log('  - ' + p.name)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
