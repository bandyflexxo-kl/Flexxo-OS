import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge, { statusColor } from '@/components/ui/Badge'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await verifySession()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const [
    statusCounts,
    pipelineCounts,
    followUpsDue,
    recentActivities,
    inactiveCompanies,
  ] = await Promise.all([
    prisma.company.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.pipelineStageHistory.groupBy({
      by: ['stageId'],
      where: { exitedAt: null },
      _count: { id: true },
    }),
    prisma.activity.findMany({
      where: {
        followUpAt: { gte: today, lt: tomorrow },
        OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
      },
      include: { company: true, contact: true },
      orderBy: { followUpAt: 'asc' },
      take: 10,
    }),
    prisma.activity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { company: true, user: true },
    }),
    prisma.company.findMany({
      where: {
        status: { in: ['Lead', 'Contacted', 'Active Customer'] },
        activities: { none: { createdAt: { gte: thirtyDaysAgo } } },
      },
      take: 10,
      orderBy: { updatedAt: 'asc' },
    }),
  ])

  const stages = await prisma.pipelineStageDefinition.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))
  const totalInPipeline = pipelineCounts.reduce((s, r) => s + r._count.id, 0)

  return (
    <div>
      <Topbar title={`Good morning, ${session.name.split(' ')[0]}`} />
      <div className="p-8 space-y-8">

        {/* Status summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {['Lead', 'Active Customer', 'Contacted', 'Lost'].map((status) => {
            const count = statusCounts.find((r) => r.status === status)?._count?.id ?? 0
            return (
              <Link key={status} href={`/companies?status=${encodeURIComponent(status)}`}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
                <div className="text-2xl font-bold text-gray-900">{count}</div>
                <div className="text-sm text-gray-500 mt-1">{status}</div>
              </Link>
            )
          })}
        </div>

        {/* Pipeline stage bar chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Pipeline Distribution</h2>
          <div className="space-y-2">
            {pipelineCounts
              .sort((a, b) => {
                const sa = stageMap[a.stageId]?.sortOrder ?? 99
                const sb = stageMap[b.stageId]?.sortOrder ?? 99
                return sa - sb
              })
              .map((r) => {
                const stage = stageMap[r.stageId]
                if (!stage) return null
                const pct = totalInPipeline > 0 ? (r._count.id / totalInPipeline) * 100 : 0
                return (
                  <div key={r.stageId} className="flex items-center gap-3">
                    <div className="w-40 text-xs text-gray-600 truncate">{stage.name}</div>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: stage.colorHex ?? '#94A3B8' }}
                      />
                    </div>
                    <div className="w-6 text-xs text-gray-500 text-right">{r._count.id}</div>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Follow-ups due today */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">
              Follow-ups Due Today
              {followUpsDue.length > 0 && (
                <span className="ml-2 bg-red-100 text-red-700 text-xs rounded-full px-2 py-0.5">{followUpsDue.length}</span>
              )}
            </h2>
            {followUpsDue.length === 0 ? (
              <p className="text-sm text-gray-400">No follow-ups due today.</p>
            ) : (
              <ul className="space-y-2">
                {followUpsDue.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <div>
                      <Link href={`/companies/${a.companyId}`} className="font-medium text-blue-600 hover:underline">
                        {a.company.name}
                      </Link>
                      <div className="text-xs text-gray-500">{a.subject}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Companies inactive 30+ days */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 text-yellow-700">
              No Activity in 30+ Days
            </h2>
            {inactiveCompanies.length === 0 ? (
              <p className="text-sm text-gray-400">All active companies have recent activity.</p>
            ) : (
              <ul className="space-y-2">
                {inactiveCompanies.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <Link href={`/companies/${c.id}`} className="text-blue-600 hover:underline truncate">
                      {c.name}
                    </Link>
                    <Badge color={statusColor(c.status)}>{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Recent activities */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Recent Activities</h2>
          {recentActivities.length === 0 ? (
            <p className="text-sm text-gray-400">No activities yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 font-medium">By</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentActivities.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">
                      <Link href={`/companies/${a.companyId}`} className="text-blue-600 hover:underline">
                        {a.company.name}
                      </Link>
                    </td>
                    <td className="py-2 text-gray-500">{a.activityType}</td>
                    <td className="py-2 text-gray-700 truncate max-w-xs">{a.subject}</td>
                    <td className="py-2 text-gray-500">{a.user.name}</td>
                    <td className="py-2 text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}
