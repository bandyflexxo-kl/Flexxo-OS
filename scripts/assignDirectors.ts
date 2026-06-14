/**
 * scripts/assignDirectors.ts
 * Grants the Director role (top management) to TIMOTHY, BANDY, JAVENN.
 * Their previous active roles are revoked (one active role per user).
 * Run: npx tsx scripts/assignDirectors.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const DIRECTORS = ['TIMOTHY', 'BANDY', 'JAVENN']

async function main() {
  const { prisma } = await import('../lib/prisma')

  // Ensure Director role exists (idempotent)
  const director = await prisma.role.upsert({
    where:  { name: 'Director' },
    update: {},
    create: { name: 'Director', description: 'Top management — full access to everything including Reports' },
  })

  for (const name of DIRECTORS) {
    const user = await prisma.user.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, isActive: true, customerCompanyId: null },
      select: { id: true, name: true, email: true,
        userRoles: { where: { revokedAt: null }, select: { id: true, role: { select: { name: true } } } } },
    })
    if (!user) { console.log(`SKIP: no active user named ${name}`); continue }

    const already = user.userRoles.some(r => r.role.name === 'Director')
    if (already) { console.log(`OK (already Director): ${user.name}`); continue }

    await prisma.$transaction(async tx => {
      // Revoke current roles
      await tx.userRole.updateMany({
        where: { userId: user.id, revokedAt: null },
        data:  { revokedAt: new Date() },
      })
      await tx.userRole.create({ data: { userId: user.id, roleId: director.id } })
    })
    console.log(`PROMOTED to Director: ${user.name} (${user.email}) — was ${user.userRoles.map(r => r.role.name).join('+') || 'none'}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
