import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import QneSyncPanel from '@/components/admin/QneSyncPanel'

export default async function AdminPage() {
  const session = await verifySession()

  const [rawSyncs, pendingCount] = await Promise.all([
    prisma.qneSyncLog.findMany({
      where:   { syncType: 'customer' },
      orderBy: { startedAt: 'desc' },
      take:    5,
      select: {
        id:              true,
        status:          true,
        recordsReceived: true,
        recordsStaged:   true,
        recordsFailed:   true,
        recordsSkipped:  true,
        errorSummary:    true,
        startedAt:       true,
        completedAt:     true,
      },
    }),
    prisma.qneCustomerStaging.count({ where: { stagingStatus: 'pending_review' } }),
  ])

  const recentSyncs = rawSyncs.map(log => ({
    ...log,
    startedAt:   log.startedAt.toISOString(),
    completedAt: log.completedAt?.toISOString() ?? null,
  }))

  return (
    <div>
      <Topbar title="Admin" />
      <div className="p-8 max-w-xl space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-400">Logged in as</p>
            <p className="text-sm font-medium text-gray-900">{session.name}</p>
            <p className="text-sm text-gray-500">{session.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">Role: {session.role}</p>
          </div>
          <hr />
          <p className="text-sm text-gray-400">User management, role assignments, and system settings coming in a future phase.</p>
        </div>

        {pendingCount > 0 && (
          <Link
            href="/admin/qne-review"
            className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl p-5 hover:bg-blue-100 transition-colors group"
          >
            <div>
              <p className="text-sm font-semibold text-blue-800">
                {pendingCount} customer{pendingCount !== 1 ? 's' : ''} awaiting review
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                QNE staging queue — promote to add them to the CRM
              </p>
            </div>
            <span className="text-blue-400 group-hover:translate-x-0.5 transition-transform text-lg">→</span>
          </Link>
        )}

        <QneSyncPanel recentSyncs={recentSyncs} pendingCount={pendingCount} />
      </div>
    </div>
  )
}
