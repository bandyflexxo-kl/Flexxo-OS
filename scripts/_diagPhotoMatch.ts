import { prisma } from '@/lib/prisma'

async function main() {
  // Products WITHOUT a photo set — these are the ones we want to match
  const unmatched = await prisma.product.findMany({
    where: { isActive: true, googleDrivePhotoId: null },
    select: { name: true, qneItemCode: true, brand: true },
    orderBy: { qneInvoiceFreq: 'desc' },
    take: 50,
  })
  console.log(`\n=== TOP 50 UNMATCHED PRODUCTS (by invoice freq) === total≈${unmatched.length}`)
  for (const p of unmatched) console.log(`  code="${p.qneItemCode}"  name="${p.name}"  brand="${p.brand}"`)

  // Products WITH a photo — how many and a quick sample
  const matched = await prisma.product.count({ where: { isActive: true, googleDrivePhotoId: { not: null } } })
  console.log(`\n=== PHOTO COVERAGE: ${matched} have photo, ${7533 - matched} unmatched ===`)

  await prisma.$disconnect()
}
main().catch(console.error)
