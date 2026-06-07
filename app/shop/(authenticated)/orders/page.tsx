import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import ReorderButton from '@/components/shop/ReorderButton'

const STATUS_COLORS: Record<string, string> = {
  Confirmed:       'bg-yellow-100 text-yellow-700',
  Approved:        'bg-indigo-100 text-indigo-700',
  Picking:         'bg-yellow-100 text-yellow-700',
  Packed:          'bg-orange-100 text-orange-700',
  Processing:      'bg-indigo-100 text-indigo-700',
  Shipped:         'bg-purple-100 text-purple-700',
  Delivering:      'bg-purple-100 text-purple-700',
  Delivered:       'bg-green-100 text-green-700',
  ReadyToCollect:  'bg-teal-100 text-teal-700',
  Collected:       'bg-green-100 text-green-700',
}

// Portal-friendly display labels for raw internal statuses
const STATUS_LABELS: Record<string, string> = {
  Confirmed:       'Confirmed',
  Approved:        'Processing',
  Picking:         'Processing',
  Packed:          'Packed',
  Delivering:      'On the Way',
  Delivered:       'Delivered',
  ReadyToCollect:  'Ready to Collect',
  Collected:       'Collected',
}

export default async function ShopOrdersPage() {
  const session = await getOptionalSession()
  if (!session?.customerCompanyId) return null

  const orders = await prisma.order.findMany({
    where:   { companyId: session.customerCompanyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, referenceNo: true, status: true,
      currency: true, totalAmount: true, createdAt: true, deliveredAt: true,
      quotation: { select: { referenceNo: true } },
      _count: { select: { items: true } },
    },
  })

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">My Orders</h1>

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center space-y-3">
          <p className="text-5xl">📦</p>
          <p className="text-gray-500 text-sm">No orders yet.</p>
          <p className="text-gray-400 text-xs">Orders appear here once you accept a quotation.</p>
          <Link href="/shop/quotations" className="inline-block text-sm text-green-600 hover:underline">
            View my quotations
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Order Ref</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Quotation</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">
                    {o.referenceNo ?? o.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                    {o.status === 'ReadyToCollect' && (
                      <span className="ml-2 text-xs text-teal-600 font-medium animate-pulse">Ready!</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {o.quotation?.referenceNo ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o._count.items}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {o.totalAmount ? `${o.currency} ${Number(o.totalAmount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(o.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Condition 24: Reorder button for authenticated users */}
                      <ReorderButton orderId={o.id} />
                      <Link
                        href={`/shop/orders/${o.id}`}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        View →
                      </Link>
                    </div>
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
