import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { companyOwnerFilter } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'

const STATUS_COLORS: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-blue-100 text-blue-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
  expired:        'bg-gray-100 text-gray-500',
}

export default async function QuotationsPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const ownerFilter = companyOwnerFilter(session)

  const quotations = await prisma.quotation.findMany({
    where: {
      status:  { not: 'cart' },
      company: ownerFilter,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      company:   { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count:    { select: { items: true } },
    },
    take: 200,
  })

  const pendingCount = quotations.filter(q => q.status === 'pending_review').length

  return (
    <div>
      <Topbar title="Quotations" />
      <div className="p-6 space-y-5">

        {/* Stats row */}
        <div className="flex flex-wrap gap-3">
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-gray-900">{quotations.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total</p>
          </div>
          {pendingCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
              <p className="text-2xl font-bold text-yellow-700">{pendingCount}</p>
              <p className="text-xs text-yellow-600 mt-0.5">Pending Review</p>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-purple-700">{quotations.filter(q => q.status === 'sent').length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Sent</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-green-700">{quotations.filter(q => q.status === 'accepted').length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Accepted</p>
          </div>
        </div>

        {/* Table */}
        {quotations.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center space-y-3">
            <p className="text-4xl">📄</p>
            <p className="text-gray-500 text-sm">No quotations yet.</p>
            <p className="text-xs text-gray-400">Quotations are created when customers check out from the portal,<br/>or you can start one manually from a company page.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Created By</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map(q => (
                  <tr key={q.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{q.referenceNo}</td>
                    <td className="px-4 py-3">
                      <Link href={`/companies/${q.company.id}`} className="text-gray-700 hover:text-blue-600 transition-colors">
                        {q.company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {q.status.replace(/_/g, ' ')}
                      </span>
                      {q.status === 'pending_review' && (
                        <span className="ml-1.5 text-xs text-yellow-600 font-medium animate-pulse">Action needed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{q._count.items}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {q.totalAmount ? `MYR ${Number(q.totalAmount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{q.createdBy.name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(q.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/quotations/${q.id}`}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
