import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')

  const total  = await prisma.qneCustomerStaging.count()
  const withSp = await prisma.qneCustomerStaging.count({ where: { rawSalesPerson: { not: null } } })
  const rows   = await prisma.qneCustomerStaging.findMany({
    select: { qneCustomerCode: true, rawName: true, rawSalesPerson: true },
    take: 15,
    orderBy: { stagedAt: 'desc' },
  })

  console.log(`\nTotal staging rows : ${total}`)
  console.log(`With rawSalesPerson: ${withSp}`)
  console.log(`Without            : ${total - withSp}\n`)
  rows.forEach(r =>
    console.log(
      r.qneCustomerCode.padEnd(12),
      (r.rawName ?? '').substring(0, 28).padEnd(28),
      'sp:', r.rawSalesPerson ?? '(null)'
    )
  )
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
