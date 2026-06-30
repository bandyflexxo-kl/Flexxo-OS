import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
  expired:        'bg-gray-100 text-gray-500',
  qne:            'bg-blue-50 text-blue-600',
}

type Row = {
  key: string; ref: string; status: string; items: number
  total: number | null; currency: string; date: Date; href: string; source: 'portal' | 'qne'
}

export default async function ShopQuotationsPage() {
  const session = await getOptionalShopSession()
  if (!session?.customerCompanyId) return null

  // Portal quotations (created via the cart) + the full QNE quotation history
  // synced from the accounting system — merged into one list, newest first.
  const [crm, qne] = await Promise.all([
    prisma.quotation.findMany({
      where:   { companyId: session.customerCompanyId, status: { not: 'cart' } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, referenceNo: true, status: true, totalAmount: true, currency: true, createdAt: true, _count: { select: { items: true } } },
    }),
    prisma.qneQuotation.findMany({
      where:   { companyId: session.customerCompanyId },
      orderBy: { docDate: 'desc' },
      select:  { id: true, docNo: true, docDate: true, totalAmount: true, _count: { select: { items: true } } },
    }),
  ])

  const rows: Row[] = [
    ...crm.map(q => ({
      key: 'c' + q.id, ref: q.referenceNo ?? '—', status: q.status, items: q._count.items,
      total: q.totalAmount ? Number(q.totalAmount) : null, currency: q.currency,
      date: q.createdAt, href: `/shop/quotations/${q.id}`, source: 'portal' as const,
    })),
    ...qne.map(q => ({
      key: 'q' + q.id, ref: q.docNo, status: 'qne', items: q._count.items,
      total: Number(q.totalAmount), currency: 'MYR',
      date: q.docDate, href: `/shop/quotations/qne/${q.id}`, source: 'qne' as const,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Quotations</h1>
        <p className="text-xs text-gray-400 mt-0.5">Your portal requests plus your full quotation history from Flexxo.</p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center space-y-3">
          <p className="text-5xl">📄</p>
          <p className="text-gray-500 text-sm">No quotations yet.</p>
          <Link href="/shop/products" className="inline-block text-sm text-green-600 hover:underline">
            Browse products and request a quote
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Quotation No.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(q => (
                <tr key={q.key} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{q.ref}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {q.source === 'qne' ? 'On record' : q.status.replace(/_/g, ' ')}
                    </span>
                    {q.status === 'sent' && (
                      <span className="ml-2 text-xs text-purple-600 font-medium animate-pulse">Action required</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{q.items}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {q.total != null ? `${q.currency} ${q.total.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(q.date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={q.href}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
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
