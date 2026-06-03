import { config } from 'dotenv'
import { resolve } from 'path'

// Load env BEFORE any Prisma imports (ESM hoisting workaround via dynamic import)
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')

  const total     = await prisma.product.count()
  const visible   = await prisma.product.count({ where: { isVisibleToCustomers: true } })
  const withPrice = await prisma.product.count({ where: { priceVersions: { some: { isCurrent: true } } } })
  const cats      = await prisma.productCategory.count()

  console.log('=== Products in database ===')
  console.log('Total products:       ', total)
  console.log('Visible to customers: ', visible)
  console.log('With current price:   ', withPrice)
  console.log('Product categories:   ', cats)

  if (total > 0) {
    const sample = await prisma.product.findMany({
      take:    5,
      select:  { name: true, isVisibleToCustomers: true, isActive: true, qneItemCode: true },
      orderBy: { name: 'asc' },
    })
    console.log('\nSample products:')
    sample.forEach(p =>
      console.log(` - ${p.name} | visible=${p.isVisibleToCustomers} | active=${p.isActive} | code=${p.qneItemCode ?? 'none'}`)
    )
  } else {
    console.log('\n⚠️  No products found in the database.')
    console.log('Products are created via the Supplier Price Import flow.')
    console.log('Go to /admin/suppliers → upload a price file → approve staging rows.')
  }

  await prisma.$disconnect()
}

main().catch(console.error)
