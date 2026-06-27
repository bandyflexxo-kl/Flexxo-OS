/**
 * Seed the two new tender roles (SuperAdmin, Purchaser) into the roles table
 * so they can be granted via /admin/users. Idempotent.
 * Run: npx tsx scripts/_seedTenderRoles.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { prisma } = await import('../lib/prisma')

  const roles = [
    { name: 'SuperAdmin', description: 'Top system role — all access plus tender price-lock override and settings.' },
    { name: 'Purchaser',  description: 'Procurement — tender Stage 4 (client PO) and Stage 5 (supplier PO).' },
  ]
  for (const r of roles) {
    const existing = await prisma.role.findUnique({ where: { name: r.name } })
    if (existing) {
      console.log(`= ${r.name} already exists`)
      continue
    }
    await prisma.role.create({ data: r })
    console.log(`+ created role ${r.name}`)
  }
  const all = await prisma.role.findMany({ select: { name: true }, orderBy: { name: 'asc' } })
  console.log('\nRoles now:', all.map(a => a.name).join(', '))
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
