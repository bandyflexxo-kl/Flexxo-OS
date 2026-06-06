import { verifySession }                       from '@/lib/session'
import { prisma }                               from '@/lib/prisma'
import Topbar                                   from '@/components/layout/Topbar'
import Badge, { statusColor, temperatureColor } from '@/components/ui/Badge'
import Link                                     from 'next/link'
import { companyOwnerFilter }                   from '@/lib/authorization'
import CompaniesFilterBar                       from '@/components/crm/CompaniesFilterBar'

interface SearchParams {
  q?:               string
  status?:          string
  industry?:        string
  leadTemperature?: string
  sort?:            string
  dir?:             'asc' | 'desc'
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session     = await verifySession()
  const sp          = await searchParams
  const ownerFilter = companyOwnerFilter(session)

  const where: Record<string, unknown> = { ...ownerFilter }
  if (sp.q) {
    where.OR = [
      { name:         { contains: sp.q, mode: 'insensitive' } },
      { generalEmail: { contains: sp.q, mode: 'insensitive' } },
    ]
  }
  if (sp.status)          where.status           = sp.status
  if (sp.industry)        where.industry         = sp.industry
  if (sp.leadTemperature) where.leadTemperature  = sp.leadTemperature

  const orderByField = sp.sort ?? 'createdAt'
  const orderDir     = sp.dir  ?? 'desc'

  const [companies, industries] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        assignments: {
          where:   { isPrimary: true, unassignedAt: null },
          include: { user: true },
          take:    1,
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take:    1,
        },
        pipelineHistory: {
          where:   { exitedAt: null },
          include: { stage: true },
          orderBy: { enteredAt: 'desc' },
          take:    1,
        },
      },
      orderBy: { [orderByField]: orderDir },
      take:    200,
    }),
    prisma.company.findMany({
      where:    { industry: { not: null }, ...ownerFilter },
      select:   { industry: true },
      distinct: ['industry'],
      orderBy:  { industry: 'asc' },
    }),
  ])

  const industryList = industries.map(i => i.industry!).filter(Boolean)

  // Sort link helper
  function sortHref(field: string) {
    const params = new URLSearchParams()
    if (sp.q)               params.set('q',              sp.q)
    if (sp.status)          params.set('status',          sp.status)
    if (sp.industry)        params.set('industry',        sp.industry)
    if (sp.leadTemperature) params.set('leadTemperature', sp.leadTemperature)
    const isActive  = orderByField === field
    const nextDir   = isActive && orderDir === 'asc' ? 'desc' : 'asc'
    params.set('sort', field)
    params.set('dir',  nextDir)
    return `/companies?${params.toString()}`
  }

  function SortIcon({ field }: { field: string }) {
    if (orderByField !== field) return <span className="text-gray-300 ml-0.5">↕</span>
    return <span className="text-blue-500 ml-0.5">{orderDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div>
      <Topbar
        title="Companies"
        actions={
          <Link
            href="/companies/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            + Add Company
          </Link>
        }
      />

      <div className="p-6 lg:p-8">

        {/* Live filter bar (client component) */}
        <CompaniesFilterBar
          industries={industryList}
          currentQ={sp.q}
          currentStatus={sp.status}
          currentIndustry={sp.industry}
          currentTemp={sp.leadTemperature}
        />

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/70">
                <th className="px-4 py-3 font-semibold">
                  <Link href={sortHref('name')} className="hover:text-gray-700 transition-colors">
                    Company <SortIcon field="name" />
                  </Link>
                </th>
                <th className="px-4 py-3 font-semibold hidden lg:table-cell">Industry</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Temp</th>
                <th className="px-4 py-3 font-semibold hidden xl:table-cell">Assigned To</th>
                <th className="px-4 py-3 font-semibold hidden lg:table-cell">Pipeline Stage</th>
                <th className="px-4 py-3 font-semibold">
                  <Link href={sortHref('createdAt')} className="hover:text-gray-700 transition-colors">
                    Last Activity <SortIcon field="createdAt" />
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="text-3xl mb-2">🔍</div>
                    <p className="text-gray-500 font-medium text-sm">No companies found</p>
                    <p className="text-gray-400 text-xs mt-1">Try adjusting your filters</p>
                  </td>
                </tr>
              )}
              {companies.map(c => {
                const assignee     = c.assignments[0]?.user
                const lastActivity = c.activities[0]
                const stage        = c.pipelineHistory[0]?.stage
                const lastActivityDate = lastActivity
                  ? new Date(lastActivity.createdAt)
                  : null
                const daysSince = lastActivityDate
                  ? Math.floor((Date.now() - lastActivityDate.getTime()) / 86_400_000)
                  : null

                return (
                  <tr key={c.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors group-hover:text-blue-600">
                        {c.name}
                      </Link>
                      {c.isDuplicateSuspect && (
                        <span className="ml-2 text-xs text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded-md">⚠ dup</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">{c.industry ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={statusColor(c.status)}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.leadTemperature ? (
                        <Badge color={temperatureColor(c.leadTemperature)}>
                          {c.leadTemperature === 'Hot' ? '🔥' : c.leadTemperature === 'Warm' ? '☀️' : '❄️'} {c.leadTemperature}
                        </Badge>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden xl:table-cell">
                      {assignee?.name ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {stage ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: `${stage.colorHex ?? '#94A3B8'}22`, color: stage.colorHex ?? '#94A3B8' }}>
                          {stage.name}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lastActivityDate ? (
                        <span className={daysSince !== null && daysSince > 30 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                          {daysSince === 0 ? 'Today' :
                           daysSince === 1 ? 'Yesterday' :
                           daysSince !== null && daysSince < 30 ? `${daysSince}d ago` :
                           lastActivityDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">
          {companies.length} compan{companies.length !== 1 ? 'ies' : 'y'}
          {(sp.q || sp.status || sp.industry || sp.leadTemperature) && ' matching filters'}
        </p>
      </div>
    </div>
  )
}
