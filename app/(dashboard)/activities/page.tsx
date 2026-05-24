import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge from '@/components/ui/Badge'
import Link from 'next/link'

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; followUpStatus?: string; userId?: string }>
}) {
  await verifySession()
  const sp = await searchParams

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const where: Record<string, unknown> = {}
  if (sp.type) where.activityType = sp.type
  if (sp.followUpStatus) where.followUpStatus = sp.followUpStatus
  if (sp.userId) where.userId = sp.userId

  const [followUpsDue, activities, users] = await Promise.all([
    prisma.activity.findMany({
      where: {
        followUpAt: { gte: today, lt: tomorrow },
        OR: [{ followUpStatus: 'Pending' }, { followUpStatus: null }],
      },
      include: { company: true, contact: true, user: true },
      orderBy: { followUpAt: 'asc' },
    }),
    prisma.activity.findMany({
      where,
      include: { company: true, contact: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  const activityTypes = ['Call', 'Email', 'Email_Received', 'WhatsApp', 'Meeting', 'Note', 'Quotation_Sent', 'Reorder_Reminder', 'System']

  return (
    <div>
      <Topbar title="Activities" />
      <div className="p-8 space-y-6">

        {followUpsDue.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-yellow-800 mb-3">
              Follow-ups Due Today ({followUpsDue.length})
            </h2>
            <div className="space-y-2">
              {followUpsDue.map((a) => (
                <div key={a.id} className="flex items-center gap-3 text-sm">
                  <Link href={`/companies/${a.companyId}`} className="text-blue-600 hover:underline font-medium">
                    {a.company.name}
                  </Link>
                  <span className="text-gray-500">{a.subject}</span>
                  <Badge>{a.activityType}</Badge>
                  <span className="text-xs text-gray-400 ml-auto">by {a.user.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <form className="flex flex-wrap gap-3">
          <select name="type" defaultValue={sp.type ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Types</option>
            {activityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select name="followUpStatus" defaultValue={sp.followUpStatus ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Follow-up Statuses</option>
            {['Pending', 'Done', 'Snoozed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="userId" defaultValue={sp.userId ?? ''} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All Users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button type="submit" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">Filter</button>
          <Link href="/activities" className="text-sm text-gray-400 flex items-center px-2">Clear</Link>
        </form>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Follow-up</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No activities found.</td></tr>
              )}
              {activities.map((a) => (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/companies/${a.companyId}`} className="text-blue-600 hover:underline">{a.company.name}</Link>
                  </td>
                  <td className="px-4 py-3"><Badge>{a.activityType}</Badge></td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{a.subject}</td>
                  <td className="px-4 py-3 text-gray-500">{a.contact?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {a.followUpAt ? (
                      <span className={`text-xs ${new Date(a.followUpAt) < new Date() ? 'text-red-500' : 'text-gray-500'}`}>
                        {new Date(a.followUpAt).toLocaleDateString()} {a.followUpStatus ? `(${a.followUpStatus})` : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{a.user.name}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
