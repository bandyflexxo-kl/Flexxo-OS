/**
 * Create salesperson CRM accounts from rawSalesPerson already stored on companies.
 * Also creates company assignments linking each salesperson to their accounts.
 *
 * Uses data already in the database — no QNE API call needed.
 * Run: npx tsx scripts/createSalespersonAccounts.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Map rawSalesPerson names (as stored from QNE) → placeholder email
// These match the agent staffCodes from QNE (e.g. "JUSTINE YONG")
const AGENT_EMAILS: Record<string, string> = {
  'JAVENN':        'sales1@kl.flexxo.com.my',
  'BANDY':         'sales.6@flexxo.internal',
  'JUSTINE':       'justine.yong@flexxo.internal',
  'JUSTINE YONG':  'justine.yong@flexxo.internal',
  'TIMOTHY':       'tim@flexxo.com.my',
  'LAI':           'sales.5@flexxo.internal',
  'VOON':          'sales.4@flexxo.internal',
  'CHAN KUN SHEN': 'sales.7@flexxo.internal',
  'ANGEL':         'sales.8@flexxo.internal',
  'HU YUN CHIN':   'sales.3@flexxo.internal',
  'LING':          'sales.9@flexxo.internal',
}

async function main() {
  const { prisma } = await import('../lib/prisma')

  console.log('=== Create Salesperson Accounts ===\n')

  // 1. Get all promoted staging records that have rawSalesPerson
  // Read the fresh pending_review records (just re-synced from QNE with rawSalesPerson populated)
  // Match them to existing companies via qneCustomerCode
  const stagingRecords = await prisma.qneCustomerStaging.findMany({
    where:  { stagingStatus: 'pending_review', rawSalesPerson: { not: null } },
    select: { qneCustomerCode: true, rawSalesPerson: true },
  })
  console.log(`Pending records with rawSalesPerson: ${stagingRecords.length}`)

  // Look up the promoted company for each staging record by QNE code
  const companies: { id: string; rawSalesPerson: string }[] = []
  for (const r of stagingRecords) {
    const company = await prisma.company.findFirst({
      where:  { qneCustomerCode: r.qneCustomerCode },
      select: { id: true },
    })
    if (company) companies.push({ id: company.id, rawSalesPerson: r.rawSalesPerson! })
  }
  console.log(`Matched to companies: ${companies.length}`)

  // 2. Find distinct salespeople
  const distinctNames = [...new Set(companies.map(c => c.rawSalesPerson.trim().toUpperCase()))]
  console.log(`Distinct salespeople: ${distinctNames.length}`)
  console.log('  Names:', distinctNames.join(', '))

  // 3. Get Salesperson role
  const salesRole = await prisma.role.findFirst({ where: { name: 'Salesperson' } })
  if (!salesRole) throw new Error('Salesperson role not found — run seed first')

  // 4. Find or create a CRM user for each salesperson
  const salespersonMap = new Map<string, string>() // rawName (upper) → userId

  for (const rawName of distinctNames) {
    // Try to find existing user by name (case-insensitive)
    const existing = await prisma.user.findFirst({
      where: { name: { equals: rawName, mode: 'insensitive' } },
    })

    if (existing) {
      salespersonMap.set(rawName, existing.id)
      console.log(`  ✓ Found existing user: ${existing.name} (${existing.email})`)
      continue
    }

    // Determine email
    const email = AGENT_EMAILS[rawName]
      ?? `${rawName.toLowerCase().replace(/\s+/g, '.')}.replace(/[^a-z0-9.]/g, '')@flexxo.internal`

    // Check email not already taken
    const emailTaken = await prisma.user.findUnique({ where: { email } })
    const finalEmail = emailTaken ? `${rawName.toLowerCase().replace(/\s+/g, '-')}@flexxo.internal` : email

    // Create user
    const newUser = await prisma.user.create({
      data: {
        name:             rawName,
        email:            finalEmail,
        passwordHash:     'placeholder-needs-reset',
        mustChangePassword: true,
        isActive:         true,
        userRoles: { create: { roleId: salesRole.id } },
      },
    })

    salespersonMap.set(rawName, newUser.id)
    console.log(`  + Created: ${newUser.name} (${newUser.email})`)
  }

  // 5. Create company assignments
  let assigned = 0
  let alreadyAssigned = 0

  for (const company of companies) {
    const upperName = company.rawSalesPerson.trim().toUpperCase()
    const userId = salespersonMap.get(upperName)
    if (!userId) continue

    // Check if already assigned
    const existing = await prisma.companyAssignment.findFirst({
      where: { companyId: company.id, userId, unassignedAt: null },
    })
    if (existing) { alreadyAssigned++; continue }

    await prisma.companyAssignment.create({
      data: {
        companyId:     company.id,
        userId,
        roleInAccount: 'Primary',
        isPrimary:     true,
      },
    })
    assigned++
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Salesperson accounts: ${salespersonMap.size}`)
  console.log(`Assignments created:  ${assigned}`)
  console.log(`Already assigned:     ${alreadyAssigned}`)
  console.log('\nNext: go to /admin/users to set passwords for each salesperson.')

  await prisma.$disconnect()
}

main().catch(e => { console.error('Error:', e); process.exit(1) })
