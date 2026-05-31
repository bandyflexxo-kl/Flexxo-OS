import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import QneReviewTable from '@/components/admin/QneReviewTable'

export default async function QneReviewPage() {
  const session = await verifySession()
  if (session.role !== 'Admin') {
    return (
      <div>
        <Topbar title="QNE Review" />
        <div className="p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  // Fetch all staging rows grouped by status for stats, plus the pending ones for the table.
  const [statusCounts, pendingRows, existingCodes] = await Promise.all([
    prisma.qneCustomerStaging.groupBy({
      by: ['stagingStatus'],
      _count: { id: true },
    }),
    prisma.qneCustomerStaging.findMany({
      where:   { stagingStatus: 'pending_review' },
      orderBy: { stagedAt: 'asc' },
      select: {
        id:              true,
        qneCustomerCode: true,
        rawName:         true,
        rawPhone:        true,
        rawEmail:        true,
        rawPaymentTerm:  true,
        rawAddress:      true,
        rawIndustry:     true,
        rawSalesPerson:  true,
        stagedAt:        true,
      },
    }),
    // Pre-load existing company codes so we can flag duplicates without extra queries.
    prisma.company.findMany({
      where:  { qneCustomerCode: { not: null } },
      select: { qneCustomerCode: true, name: true },
    }),
  ])

  const codeToName = new Map(
    existingCodes.map(c => [c.qneCustomerCode!, c.name])
  )

  const counts = Object.fromEntries(statusCounts.map(s => [s.stagingStatus, s._count.id]))
  const stats = {
    pending:  counts['pending_review'] ?? 0,
    approved: counts['approved']        ?? 0,
    rejected: counts['rejected']        ?? 0,
  }

  const rows = pendingRows.map(row => ({
    ...row,
    stagedAt:            row.stagedAt.toISOString(),
    existingCompanyName: codeToName.get(row.qneCustomerCode) ?? null,
    rawSalesPerson:      row.rawSalesPerson ?? null,
  }))

  return (
    <div>
      <Topbar
        title="QNE Review Queue"
        actions={
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Admin
          </Link>
        }
      />
      <div className="p-8">
        <QneReviewTable rows={rows} stats={stats} />
      </div>
    </div>
  )
}
