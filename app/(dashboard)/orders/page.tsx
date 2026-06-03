import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { companyOwnerFilter } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'

const STATUS_COLORS: Record<string, string> = {
  Confirmed:  'bg-blue-100 text-blue-700',
  Processing: 'bg-yellow-100 text-yellow-700',
  Shipped:    'bg-purple-100 text-purple-700',
  Delivered:  'bg-green-100 text-green-700',
}

export default async function OrdersPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  if (session.role === 'B2B Client') redirect('/')

  const orders = await prisma.order.findMany({
    where:   { company: companyOwnerFilter(session) },
    orderBy: { createdAt: 'desc' },
    include: {
      company:   { select: { id: true, name: true } },
      quotation: { select: { referenceNo: true } },
    },
  })

  const stats = {
    total:      orders.length,
    confirmed:  orders.filter(o => o.status === 'Confirmed').length,
    processing: orders.filter(o => o.status === 'Processing').length,
    shipped:    orders.filter(o => o.status === 'Shipped').length,
    delivered:  orders.filter(o => o.status === 'Delivered').length,
  }

  return (
    <div>
      <Topbar title="Orders" />
      <div className="p-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: 'Total',      value: stats.total,      color: 'text-gray-900' },
            { label: 'Confirmed',  value: stats.confirmed,  color: 'text-blue-600' },
            { label: 'Processing', value: stats.processing, color: 'text-yellow-600' },
            { label: 'Shipped',    value: stats.shipped,    color: 'text-purple-600' },
            { label: 'Delivered',  value: stats.delivered,  color: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center space-y-3">
            <p className="text-5xl">📦</p>
            <p className="text-gray-500 text-sm">No orders yet.</p>
            <p className="text-xs text-gray-400">Orders are created automatically when a customer accepts a quotation.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Order Ref</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Quotation</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">
                      {o.referenceNo ?? o.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/companies/${o.company.id}`} className="text-blue-600 hover:underline font-medium">
                        {o.company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {o.quotation?.referenceNo ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {o.totalAmount ? `${o.currency} ${Number(o.totalAmount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(o.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/orders/${o.id}`}
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
    </div>
  )
}
