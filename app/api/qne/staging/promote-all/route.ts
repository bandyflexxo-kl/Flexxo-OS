import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { normalizeName } from '@/lib/normalize'

export async function POST() {
  const session = await verifySession().catch(() => null)
  if (!session)                 return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' },    { status: 403 })

  const pending = await prisma.qneCustomerStaging.findMany({
    where: { stagingStatus: 'pending_review' },
  })

  if (pending.length === 0) {
    return Response.json({ promoted: 0, linked: 0, skipped: 0, skippedIds: [] })
  }

  // Build a lookup of existing companies by qneCustomerCode.
  const existingCodes = await prisma.company.findMany({
    where:  { qneCustomerCode: { in: pending.map(r => r.qneCustomerCode) } },
    select: { id: true, qneCustomerCode: true },
  })
  const codeMap = new Map(existingCodes.map(c => [c.qneCustomerCode!, c.id]))

  // Build salesperson name → userId lookup (case-insensitive, active users only).
  const allUsers = await prisma.user.findMany({
    where:  { isActive: true },
    select: { id: true, name: true },
  })
  const userByName = new Map(allUsers.map(u => [u.name.toLowerCase(), u.id]))

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  let promoted = 0
  let linked   = 0

  // Process in batches so a single failure doesn't abort the whole run.
  const BATCH = 50
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)

    await Promise.allSettled(
      batch.map(async (row) => {
        const existingId = codeMap.get(row.qneCustomerCode)

        let companyId: string
        let action: 'created' | 'linked'

        if (existingId) {
          companyId = existingId
          action    = 'linked'
        } else {
          const name = row.rawName?.trim() || row.qneCustomerCode
          const company = await prisma.company.create({
            data: {
              name,
              nameNormalized:  normalizeName(name),
              mainPhone:       row.rawPhone     ?? null,
              generalEmail:    row.rawEmail     ?? null,
              industry:        row.rawIndustry  ?? null,
              leadSource:      'QNE Import',
              status:          'Active Customer',
              qneCustomerCode: row.qneCustomerCode,
              qneSynced:       true,
              qneLastSyncedAt: new Date(),
              createdById:     session.userId,
              updatedAt:       new Date(),
            },
          })
          companyId = company.id
          action    = 'created'
        }

        // Assign salesperson if matched to a CRM user.
        if (row.rawSalesPerson) {
          const userId = userByName.get(row.rawSalesPerson.toLowerCase())
          if (userId) {
            const existing = await prisma.companyAssignment.findFirst({
              where: { companyId, userId, unassignedAt: null },
            })
            if (!existing) {
              await prisma.companyAssignment.create({
                data: { companyId, userId, roleInAccount: 'Primary', isPrimary: true },
              })
            }
          }
        }

        await prisma.qneCustomerStaging.update({
          where: { id: row.id },
          data: {
            stagingStatus:    'approved',
            matchedCompanyId: companyId,
            matchType:        action === 'linked' ? 'existing_by_code' : 'new_company',
            matchConfidence:  action === 'linked' ? 1.0 : null,
            reviewedById:     session.userId,
            reviewedAt:       new Date(),
          },
        })

        if (action === 'created') promoted++
        else                      linked++
      }),
    )
  }

  return Response.json({ promoted, linked, skipped: 0, skippedIds: [] })
}
