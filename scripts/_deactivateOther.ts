import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
async function main() {
  const { prisma } = await import('@/lib/prisma')
  const r = await prisma.productCategory.updateMany({
    where: { slug: 'other', isActive: true },
    data: { isActive: false },
  })
  console.log('Deactivated "Other" category. rows updated:', r.count)
  await prisma.$disconnect()
}
main().catch(console.error)
