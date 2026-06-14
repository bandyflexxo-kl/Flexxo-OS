import { verifySession }          from '@/lib/session'
import { prisma }                 from '@/lib/prisma'
import Topbar                     from '@/components/layout/Topbar'
import Badge, { statusColor }     from '@/components/ui/Badge'
import Link                       from 'next/link'
import { isPrivilegedRole, isExecutiveRole } from '@/lib/authorization'
import TodoSection                from '@/components/dashboard/TodoSection'

// ── helpers ──────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
}

function activityTypeColor(type: string): string {
  const map: Record<string, string> = {
    Call:      'bg-blue-100 text-blue-700',
    Email:     'bg-purple-100 text-purple-700',
    Meeting:   'bg-green-100 text-green-700',
    Note:      'bg-yellow-100 text-yellow-700',
    WhatsApp:  'bg-emerald-100 text-emerald-700',
    Task:      'bg-orange-100 text-orange-700',
  }
  return map[type] ?? 'bg-gray-100 text-gray-600'
}

function activityTypeIcon(type: string) {
  switch (type) {
    case 'Call':
      return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
        </svg>
      )
    case 'Email':
      return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
        </svg>
      )
    case 'Meeting':
      return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
        </svg>
      )
    default:
      return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
      )
  }
}

// ── stat card config ──────────────────────────────────────────────────────

const STAT_CARDS = [
  {
    status:      'Lead',
    label:       'Leads',
    border:      'border-l-blue-400',
    iconBg:      'bg-blue-50',
    iconColor:   'text-blue-500',
    numberColor: 'text-blue-700',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
      </svg>
    ),
  },
  {
    status:      'Active Customer',
    label:       'Active Customers',
    border:      'border-l-green-400',
    iconBg:      'bg-green-50',
    iconColor:   'text-green-500',
    numberColor: 'text-green-700',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
      </svg>
    ),
  },
  {
    status:      'Contacted',
    label:       'Contacted',
    border:      'border-l-orange-400',
    iconBg:      'bg-orange-50',
    iconColor:   'text-orange-500',
    numberColor: 'text-orange-700',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
      </svg>
    ),
  },
  {
    status:      'Lost',
    label:       'Lost',
    border:      'border-l-red-300',
    iconBg:      'bg-red-50',
    iconColor:   'text-red-400',
    numberColor: 'text-red-600',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
] as const

// ── page ─────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session      = await verifySession()
  const isPrivileged = isPrivilegedRole(session.role)
  const isExecutive  = isExecutiveRole(session.role)   // Director | Manager only

  // Malaysia time greeting
  const mykHour = (new Date().getUTCHours() + 8) % 24
  const greeting = mykHour < 12 ? 'Good morning' : mykHour < 17 ? 'Good afternoon' : 'Good evening'

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)

  let assignedCompanyIds: string[] | null = null
  if (!isPrivileged) {
    const assignments = await prisma.companyAssignment.findMany({
      where:  { userId: session.userId, unassignedAt: null },
      select: { companyId: true },
    })
    assignedCompanyIds = assignments.map(a => a.companyId)
  }

  const companyIdFilter = assignedCompanyIds !== null ? { id: { in: assignedCompanyIds } } : {}
  const companyFkFilter = assignedCompanyIds !== null ? { companyId: { in: assignedCompanyIds } } : {}

  const [statusCounts, pipelineCounts, followUpsDue, recentActivities, inactiveCompanies] =
    await Promise.all([
      prisma.company.groupBy({ by: ['status'], where: companyIdFilter, _count: { id: true } }),
      prisma.pipelineStageHistory.groupBy({
        by: ['stageId'],
        where: { exitedAt: null, ...companyFkFilter },
        _count: { id: true },
      }),
      prisma.activity.findMany({
        where: {
          followUpAt: { gte: today, lt: tomorrow },
          OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
          ...companyFkFilter,
          ...(!isPrivileged ? { userId: session.userId } : {}),
        },
        include: { company: true, contact: true },
        orderBy: { followUpAt: 'asc' },
        take: 10,
      }),
      prisma.activity.findMany({
        where:   { ...companyFkFilter },
        orderBy: { createdAt: 'desc' },
        take:    8,
        include: { company: true, user: true },
      }),
      prisma.company.findMany({
        where: {
          ...companyIdFilter,
          status: { in: ['Lead', 'Contacted', 'Active Customer'] },
          activities: { none: { createdAt: { gte: thirtyDaysAgo } } },
        },
        take: 8,
        orderBy: { updatedAt: 'asc' },
        select: { id: true, name: true, status: true, updatedAt: true },
      }),
    ])

  const stages = await prisma.pipelineStageDefinition.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  const stageMap           = Object.fromEntries(stages.map(s => [s.id, s]))
  const totalInPipeline    = pipelineCounts.reduce((s, r) => s + r._count.id, 0)
  const totalCompanies     = statusCounts.reduce((s, r) => s + r._count.id, 0)

  return (
    <div>
      <Topbar title={`${greeting}, ${session.name.split(' ')[0]} 👋`} />

      <div className="p-6 lg:p-8 space-y-6">

        {/* ── To-Do List — most important, always first ────────── */}
        <TodoSection session={session} />

        {/* ── Stat cards ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {STAT_CARDS.map(({ status, label, border, iconBg, iconColor, numberColor, icon }) => {
            const count = statusCounts.find(r => r.status === status)?._count?.id ?? 0
            const pct   = totalCompanies > 0 ? Math.round((count / totalCompanies) * 100) : 0
            return (
              <Link
                key={status}
                href={`/companies?status=${encodeURIComponent(status)}`}
                className={`bg-white rounded-xl border border-gray-200 border-l-4 ${border} p-5 hover:shadow-md transition-all group`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                    <p className={`text-3xl font-extrabold mt-1 ${numberColor} tracking-tight`}>{count}</p>
                    <p className="text-xs text-gray-400 mt-1">{pct}% of total</p>
                  </div>
                  <div className={`w-9 h-9 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                    {icon}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {/* ── Pipeline distribution ────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Pipeline Distribution</h2>
              <p className="text-xs text-gray-400 mt-0.5">{totalInPipeline} companies in active stages</p>
            </div>
            <Link href="/pipeline" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline transition-colors">
              Open Pipeline →
            </Link>
          </div>
          <div className="space-y-3">
            {pipelineCounts
              .sort((a, b) => (stageMap[a.stageId]?.sortOrder ?? 99) - (stageMap[b.stageId]?.sortOrder ?? 99))
              .map(r => {
                const stage = stageMap[r.stageId]
                if (!stage) return null
                const pct = totalInPipeline > 0 ? (r._count.id / totalInPipeline) * 100 : 0
                return (
                  <div key={r.stageId} className="flex items-center gap-3">
                    <div className="w-36 text-xs text-gray-600 truncate shrink-0" title={stage.name}>
                      {stage.name}
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`, backgroundColor: stage.colorHex ?? '#94A3B8' }}
                      />
                    </div>
                    <div className="w-8 text-xs font-semibold text-gray-600 text-right tabular-nums shrink-0">
                      {r._count.id}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* ── Follow-ups + Inactive side by side ───────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Follow-ups due today */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                Follow-ups Due Today
              </h2>
              {followUpsDue.length > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold rounded-full px-2.5 py-0.5 tabular-nums">
                  {followUpsDue.length}
                </span>
              )}
            </div>

            {followUpsDue.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <p className="text-sm text-gray-500 font-medium">All clear!</p>
                <p className="text-xs text-gray-400 mt-0.5">No follow-ups due today</p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {followUpsDue.map(a => (
                  <li key={a.id}>
                    <Link
                      href={`/companies/${a.companyId}`}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${activityTypeColor(a.activityType)}`}>
                        {activityTypeIcon(a.activityType)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
                          {a.company.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{a.subject}</p>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">
                        {a.followUpAt ? new Date(a.followUpAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* No activity in 30+ days */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800">
                No Activity in 30+ Days
              </h2>
              {inactiveCompanies.length > 0 && (
                <span className="bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full px-2.5 py-0.5 tabular-nums">
                  {inactiveCompanies.length}
                </span>
              )}
            </div>

            {inactiveCompanies.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <p className="text-sm text-gray-500 font-medium">Great coverage!</p>
                <p className="text-xs text-gray-400 mt-0.5">All active companies have recent activity</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {inactiveCompanies.map(c => {
                  const daysSince = Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86_400_000)
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/companies/${c.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                      >
                        <span className="text-sm text-gray-800 group-hover:text-blue-700 transition-colors font-medium truncate">
                          {c.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                            {daysSince}d ago
                          </span>
                          <Badge color={statusColor(c.status)}>{c.status}</Badge>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Recent activity feed — executives only ──────────── */}
        {isExecutive && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-800">Recent Activities</h2>
              <Link href="/activities" className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline transition-colors">
                View all →
              </Link>
            </div>

            {recentActivities.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No activities logged yet.</p>
            ) : (
              <div className="space-y-1">
                {recentActivities.map((a, i) => (
                  <div key={a.id} className="flex gap-3 group">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center shrink-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${activityTypeColor(a.activityType)}`}>
                        {activityTypeIcon(a.activityType)}
                      </div>
                      {i < recentActivities.length - 1 && (
                        <div className="w-px flex-1 bg-gray-100 my-1" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/companies/${a.companyId}`} className="text-sm font-semibold text-gray-900 hover:text-blue-700 transition-colors truncate block">
                            {a.company.name}
                          </Link>
                          <p className="text-xs text-gray-500 truncate mt-0.5">{a.subject}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-400">{timeAgo(new Date(a.createdAt))}</span>
                          <span className="text-xs text-gray-400 hidden sm:inline">· {a.user.name.split(' ')[0]}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
