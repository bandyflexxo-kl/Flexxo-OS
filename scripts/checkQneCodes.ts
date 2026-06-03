import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { prisma } = await import('../lib/prisma')
  const total    = await prisma.company.count()
  const withCode = await prisma.company.count({ where: { qneCustomerCode: { not: null } } })
  const sample   = await prisma.company.findFirst({
    where:  { qneCustomerCode: { not: null } },
    select: { id: true, name: true, qneCustomerCode: true },
  })
  console.log('Total companies:   ', total)
  console.log('With QNE code:     ', withCode)
  console.log('Without QNE code:  ', total - withCode)
  console.log('Sample company:    ', JSON.stringify(sample))
  await prisma.$disconnect()
}
main().catch(console.error)
