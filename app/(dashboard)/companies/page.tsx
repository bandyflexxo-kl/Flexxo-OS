import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge, { statusColor, temperatureColor } from '@/components/ui/Badge'
import Link from 'next/link'

interface SearchParams {
  q?: string
  status?: string
  industry?: string
  leadTemperature?: string
  assignedTo?: string
  sort?: string
  dir?: 'asc' | 'desc'
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await verifySession()
  const sp = await searchParams

  const where: Record<string, unknown> = {}
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: 'insensitive' } },
      { generalEmail: { contains: sp.q, mode: 'insensitive' } },
    ]
  }
  if (sp.status) where.status = sp.status
  if (sp.industry) where.industry = sp.industry
  if (sp.leadTemperature) where.leadTemperature = sp.leadTemperature

  const orderByField = sp.sort ?? 'createdAt'
  const orderDir = sp.dir ?? 'desc'

  const companies = await prisma.company.findMany({
    where,
    include: {
      assignments: {
        where: { isPrimary: true, unassignedAt: null },
        include: { user: true },
        take: 1,
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      pipelineHistory: {
        where: { exitedAt: null },
        include: { stage: true },
        orderBy: { enteredAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { [orderByField]: orderDir },
    take: 200,
  })

  const industries = await prisma.company.findMany({
    where: { industry: { not: null } },
    select: { industry: true },
    distinct: ['industry'],
  })

  return (
    <div>
      <Topbar
        title="Companies"
        actions={
          <Link
            href="/companies/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add New Company
          </Link>
        }
      />
      <div className="p-8">
        {/* Filters */}
        <form className="flex flex-wrap gap-3 mb-6">
          <input
            name="q"
            defaultValue={sp.q}
            placeholder="Search companies..."
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-60"
          />
          <select name="status" defaultValue={sp.status ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Statuses</option>
            {['Lead','Contacted','Active Customer','Inactive','Lost','Dormant'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select name="industry" defaultValue={sp.industry ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Industries</option>
            {industries.map((i) => (
              <option key={i.industry!} value={i.industry!}>{i.industry}</option>
            ))}
          </select>
          <select name="leadTemperature" defaultValue={sp.leadTemperature ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Temperatures</option>
            {['Cold','Warm','Hot'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="submit" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200 transition-colors">
            Filter
          </button>
          <Link href="/companies" className="text-sm text-gray-400 flex items-center px-2">Clear</Link>
        </form>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Company Name</th>
                <th className="px-4 py-3 font-medium">Industry</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Temperature</th>
                <th className="px-4 py-3 font-medium">Assigned To</th>
                <th className="px-4 py-3 font-medium">Pipeline Stage</th>
                <th className="px-4 py-3 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No companies found.</td>
                </tr>
              )}
              {companies.map((c) => {
                const assignee = c.assignments[0]?.user
                const lastActivity = c.activities[0]
                const stage = c.pipelineHistory[0]?.stage
                return (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="font-medium text-blue-600 hover:underline">
                        {c.name}
                      </Link>
                      {c.isDuplicateSuspect && (
                        <span className="ml-2 text-xs text-yellow-600">⚠ duplicate</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.industry ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={statusColor(c.status)}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {c.leadTemperature ? (
                        <Badge color={temperatureColor(c.leadTemperature)}>{c.leadTemperature}</Badge>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{assignee?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{stage?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {lastActivity ? new Date(lastActivity.createdAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">{companies.length} companies</p>
      </div>
    </div>
  )
}
