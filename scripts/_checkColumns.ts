import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
async function main() {
  const { prisma } = await import('@/lib/prisma')
  const cols = await prisma.$queryRaw<{column_name:string}[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'products'
    ORDER BY column_name
  `
  console.log('Products columns:', cols.map(c=>c.column_name).join(', '))
  await prisma.$disconnect()
}
main().catch(console.error)
