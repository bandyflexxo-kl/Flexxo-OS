import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')
  const cats = await prisma.productCategory.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } })
  cats.forEach(c => console.log(`${c.slug} | ${c.name} | ${c.id}`))
  await prisma.$disconnect()
}
main().catch(console.error)
