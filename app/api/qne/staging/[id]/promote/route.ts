import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { normalizeName } from '@/lib/normalize'

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/qne/staging/[id]/promote'>,
) {
  const session = await verifySession().catch(() => null)
  if (!session)                 return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' },    { status: 403 })

  const { id } = await ctx.params

  const row = await prisma.qneCustomerStaging.findUnique({ where: { id } })
  if (!row)                                   return Response.json({ error: 'Not found' },        { status: 404 })
  if (row.stagingStatus !== 'pending_review') return Response.json({ error: 'Already reviewed' }, { status: 409 })

  // Prefer linking over creating if the QNE code already exists in our system.
  const existing = await prisma.company.findFirst({
    where:  { qneCustomerCode: row.qneCustomerCode },
    select: { id: true },
  })

  let companyId: string
  let action: 'created' | 'linked'

  if (existing) {
    companyId = existing.id
    action    = 'linked'
  } else {
    const name = row.rawName?.trim() || row.qneCustomerCode
    await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

    const company = await prisma.company.create({
      data: {
        name,
        nameNormalized:  normalizeName(name),
        mainPhone:       row.rawPhone        ?? null,
        generalEmail:    row.rawEmail        ?? null,
        industry:        row.rawIndustry     ?? null,
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

  // Assign salesperson if we have a name and no active assignment yet.
  let assignedUserId: string | null = null
  if (row.rawSalesPerson) {
    const salesperson = await prisma.user.findFirst({
      where: { name: { equals: row.rawSalesPerson, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    })
    if (salesperson) {
      const existing = await prisma.companyAssignment.findFirst({
        where: { companyId, userId: salesperson.id, unassignedAt: null },
      })
      if (!existing) {
        await prisma.companyAssignment.create({
          data: { companyId, userId: salesperson.id, roleInAccount: 'Primary', isPrimary: true },
        })
      }
      assignedUserId = salesperson.id
    }
  }

  await prisma.qneCustomerStaging.update({
    where: { id },
    data: {
      stagingStatus:    'approved',
      matchedCompanyId: companyId,
      matchType:        action === 'linked' ? 'existing_by_code' : 'new_company',
      matchConfidence:  action === 'linked' ? 1.0 : null,
      reviewedById:     session.userId,
      reviewedAt:       new Date(),
    },
  })

  return Response.json({ companyId, action, assignedUserId })
}
