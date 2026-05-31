import { config } from 'dotenv'
import { resolve } from 'path'

// Load env BEFORE any Prisma/lib imports (ESM hoisting workaround via dynamic import)
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  // Dynamic imports so Prisma is instantiated AFTER env is set
  const { triggerQneCustomerSync } = await import('../lib/qneSync')
  const { prisma }                 = await import('../lib/prisma')

  const admin = await prisma.user.findFirst({
    where: { userRoles: { some: { role: { name: 'Admin' } } } },
  })
  if (!admin) throw new Error('No admin user found')

  console.log('Running sync as:', admin.email)

  const result = await triggerQneCustomerSync({
    triggeredById: admin.id,
    syncMethod:    'api_pull',
  })

  console.log('\n=== SYNC RESULT ===')
  console.log('Sync Log ID :', result.syncLogId)
  console.log('Received    :', result.received)
  console.log('Staged      :', result.staged)
  console.log('Skipped     :', result.skipped, '(already pending)')
  console.log('Failed      :', result.failed)

  const pendingTotal = await prisma.qneCustomerStaging.count({
    where: { stagingStatus: 'pending_review' },
  })
  console.log('\nTotal pending_review in staging:', pendingTotal)

  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
