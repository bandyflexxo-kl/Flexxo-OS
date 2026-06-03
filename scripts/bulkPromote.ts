/**
 * Bulk promote all QNE staging records to master companies table.
 * Skips known junk records: 700-C001 (customer testing), 700-Q001 (Quotation).
 * Run with: npx tsx scripts/bulkPromote.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const JUNK_CODES = ['700-C001', '700-Q001']

async function main() {
  const { prisma } = await import('../lib/prisma')

  const staging = await prisma.qneCustomerStaging.findMany({
    where: { status: 'pending_review' },
  })

  console.log(`Found ${staging.length} pending records`)

  let promoted = 0
  let rejected = 0
  let skipped  = 0
  let errors   = 0

  for (const record of staging) {
    // Reject junk records
    if (JUNK_CODES.includes(record.qneCode ?? '')) {
      await prisma.qneCustomerStaging.update({
        where: { id: record.id },
        data:  { status: 'rejected' },
      })
      console.log(`  ✕ Rejected junk: ${record.qneCode} — ${record.companyName}`)
      rejected++
      continue
    }

    try {
      // Check if company with this QNE code already exists
      const existing = await prisma.company.findFirst({
        where: { qneCustomerCode: record.qneCode ?? undefined },
      })

      if (existing) {
        await prisma.qneCustomerStaging.update({
          where: { id: record.id },
          data:  { status: 'promoted', promotedCompanyId: existing.id },
        })
        skipped++
        continue
      }

      // Create company from staging record
      const company = await prisma.company.create({
        data: {
          name:              record.companyName,
          qneCustomerCode:   record.qneCode ?? undefined,
          registrationNo:    record.registrationNo ?? undefined,
          phone:             record.phone ?? undefined,
          email:             record.email ?? undefined,
          address:           [record.address1, record.address2, record.address3, record.address4]
                               .filter(Boolean).join(', ') || undefined,
          rawSalesPerson:    record.rawSalesPerson ?? undefined,
          status:            'active',
          sourceOfLead:      'qne_import',
        },
      })

      await prisma.qneCustomerStaging.update({
        where: { id: record.id },
        data:  { status: 'promoted', promotedCompanyId: company.id },
      })

      promoted++
    } catch (err) {
      console.error(`  ✗ Error promoting ${record.qneCode}: ${err}`)
      errors++
    }
  }

  console.log('\n=== PROMOTE COMPLETE ===')
  console.log(`  Promoted:  ${promoted}`)
  console.log(`  Skipped (already exists): ${skipped}`)
  console.log(`  Rejected (junk): ${rejected}`)
  console.log(`  Errors:    ${errors}`)

  await prisma.$disconnect()
}

main().catch(console.error)
