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
      <div className="p-8 max-w-2xl space-y-6">
        {/* Logged-in user info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-xs text-gray-400">Logged in as</p>
          <p className="text-sm font-medium text-gray-900">{session.name}</p>
          <p className="text-sm text-gray-500">{session.email}</p>
          <p className="text-xs text-gray-400 mt-0.5">Role: {session.role}</p>
        </div>

        {/* Admin nav cards */}
        <div className="grid grid-cols-2 gap-4">
          <Link href="/admin/users" className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:bg-gray-50 hover:border-gray-300 transition-colors group">
            <span className="text-2xl">👥</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">User Management</p>
              <p className="text-xs text-gray-500 mt-0.5">Set passwords, manage roles</p>
            </div>
            <span className="ml-auto text-gray-300 group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
          <Link href="/admin/suppliers" className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:bg-gray-50 hover:border-gray-300 transition-colors group">
            <span className="text-2xl">📦</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Suppliers & Pricing</p>
              <p className="text-xs text-gray-500 mt-0.5">Upload price lists, manage costs</p>
            </div>
            <span className="ml-auto text-gray-300 group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
          <Link href="/admin/products" className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:bg-gray-50 hover:border-gray-300 transition-colors group">
            <span className="text-2xl">🛍️</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Product Catalog</p>
              <p className="text-xs text-gray-500 mt-0.5">Visibility, margins, photos</p>
            </div>
            <span className="ml-auto text-gray-300 group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
          <Link href="/admin/customer-accounts" className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:bg-gray-50 hover:border-gray-300 transition-colors group">
            <span className="text-2xl">🏪</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Customer Accounts</p>
              <p className="text-xs text-gray-500 mt-0.5">Manage B2B portal access</p>
            </div>
            <span className="ml-auto text-gray-300 group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
          <Link href="/admin/settings" className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-5 hover:bg-gray-50 hover:border-gray-300 transition-colors group">
            <span className="text-2xl">⚙️</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">System Settings</p>
              <p className="text-xs text-gray-500 mt-0.5">Default margin, global config</p>
            </div>
            <span className="ml-auto text-gray-300 group-hover:translate-x-0.5 transition-transform">→</span>
          </Link>
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
