import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
  expired:        'bg-gray-100 text-gray-500',
}

export default async function ShopQuotationsPage() {
  const session = await getOptionalSession()
  if (!session?.customerCompanyId) return null

  const quotations = await prisma.quotation.findMany({
    where:   { companyId: session.customerCompanyId, status: { not: 'cart' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, referenceNo: true, status: true,
      totalAmount: true, currency: true, createdAt: true, sentAt: true,
      _count: { select: { items: true } },
    },
  })

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">My Quotations</h1>

      {quotations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center space-y-3">
          <p className="text-5xl">📄</p>
          <p className="text-gray-500 text-sm">No quotations yet.</p>
          <Link href="/shop/products" className="inline-block text-sm text-green-600 hover:underline">
            Browse products and request a quote
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map(q => (
                <tr key={q.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{q.referenceNo}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {q.status.replace(/_/g, ' ')}
                    </span>
                    {q.status === 'sent' && (
                      <span className="ml-2 text-xs text-purple-600 font-medium animate-pulse">Action required</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{q._count.items}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {q.totalAmount ? `${q.currency} ${Number(q.totalAmount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(q.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/shop/quotations/${q.id}`}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
