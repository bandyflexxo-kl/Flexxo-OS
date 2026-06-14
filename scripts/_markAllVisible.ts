import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('@/lib/prisma')

  const before = await prisma.product.count({ where: { isActive: true, isVisibleToCustomers: false } })
  console.log('Products currently NOT visible:', before)

  const result = await prisma.product.updateMany({
    where: { isActive: true, isVisibleToCustomers: false },
    data: { isVisibleToCustomers: true },
  })
  console.log('Updated to visible:', result.count)

  const after = await prisma.product.count({ where: { isActive: true, isVisibleToCustomers: true } })
  console.log('Total now visible:', after)

  await prisma.$disconnect()
}

main().catch(console.error)
