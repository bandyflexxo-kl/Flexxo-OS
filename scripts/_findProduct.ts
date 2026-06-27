import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')
  const products = await prisma.product.findMany({
    where: { name: { contains: 'NUMBER BOOK', mode: 'insensitive' }, photoUrl: { not: null } },
    select: { id: true, name: true, photoUrl: true },
    take: 5,
  })
  products.forEach(p => console.log(p.name, '\n', p.photoUrl))
  await prisma.$disconnect()
}
main().catch(console.error)
