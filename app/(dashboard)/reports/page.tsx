import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isExecutiveRole } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'
import TeamPortfolio from '@/components/reports/TeamPortfolio'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function ReportsPage() {
  const session = await verifySession()

  // Executives only (Director / Manager) — Admin ops staff excluded:
  // margins and team performance are strategic data.
  if (!isExecutiveRole(session.role)) redirect('/')

  // ── Date boundaries ──────────────────────────────────────────────────────
  const now      = new Date()
  const moy      = now.getMonth()
  const year     = now.getFullYear()

  const thisMonthStart = new Date(year, moy, 1)
  const lastMonthStart = new Date(year, moy - 1, 1)
  const lastMonthEnd   = new Date(year, moy, 1)
  const ytdStart       = new Date(year, 0, 1)

  // ── Revenue queries ───────────────────────────────────────────────────────
  const CLOSED_STATUSES = ['Processing', 'Shipped', 'Delivered'] as const

  async function sumOrders(from: Date, to?: Date) {
    const where = {
      status:    { in: [...CLOSED_STATUSES] },
      createdAt: to ? { gte: from, lt: to } : { gte: from },
    }
    const result = await prisma.order.aggregate({ where, _sum: { totalAmount: true }, _count: true })
    return {
      amount: Number(result._sum.totalAmount ?? 0),
      count:  result._count,
    }
  }

  const [thisMth, lastMth, ytd] = await Promise.all([
    sumOrders(thisMonthStart),
    sumOrders(lastMonthStart, lastMonthEnd),
    sumOrders(ytdStart),
  ])

  // ── Per-salesperson stats ─────────────────────────────────────────────────
  const salespeople = await prisma.user.findMany({
    where: {
      isActive:  true,
      userRoles: { some: { revokedAt: null, role: { name: 'Salesperson' } } },
    },
    select: { id: true, name: true, email: true },
  })

  const spStats = await Promise.all(salespeople.map(async sp => {
    const [quoteCount, orderCount, marginResult, revenueResult] = await Promise.all([
      // Quotes created (exclude cart)
      prisma.quotation.count({
        where: { createdById: sp.id, status: { not: 'cart' } },
      }),
      // Orders closed
      prisma.order.count({
        where: { status: { in: [...CLOSED_STATUSES] }, quotation: { createdById: sp.id } },
      }),
      // Average margin from quotation items (approved, sent, accepted)
      prisma.quotationItem.aggregate({
        where: {
          quotation: {
            createdById: sp.id,
            status: { in: ['approved', 'sent', 'accepted'] },
          },
          marginPct: { not: null },
        },
        _avg: { marginPct: true },
      }),
      // Total revenue from closed orders
      prisma.order.aggregate({
        where: { status: { in: [...CLOSED_STATUSES] }, quotation: { createdById: sp.id } },
        _sum:  { totalAmount: true },
      }),
    ])

    return {
      id:         sp.id,
      name:       sp.name,
      quoteCount,
      orderCount,
      convPct:    quoteCount > 0 ? Math.round((orderCount / quoteCount) * 100) : 0,
      revenue:    Number(revenueResult._sum.totalAmount ?? 0),
      avgMargin:  marginResult._avg.marginPct
        ? Number(marginResult._avg.marginPct).toFixed(1)
        : null,
    }
  }))

  // Sort by revenue descending
  spStats.sort((a, b) => b.revenue - a.revenue)

  // ── Low-margin alerts ─────────────────────────────────────────────────────
  const LOW_MARGIN_THRESHOLD = 15

  const lowMarginItems = await prisma.quotationItem.findMany({
    where: {
      marginPct:  { lt: LOW_MARGIN_THRESHOLD, not: null },
      quotation:  { status: { in: ['approved', 'sent', 'accepted', 'pending_review'] } },
    },
    orderBy: { marginPct: 'asc' },
    take: 20,
    select: {
      id: true, description: true, unitPrice: true, unitCost: true, marginPct: true,
      quotation: {
        select: {
          id: true, referenceNo: true, status: true,
          company:   { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      },
    },
  })

  // ── Quote conversion funnel ───────────────────────────────────────────────
  const [draftCount, pendingCount, approvedCount, sentCount, acceptedCount, declinedCount] =
    await Promise.all([
      prisma.quotation.count({ where: { status: 'draft' } }),
      prisma.quotation.count({ where: { status: 'pending_review' } }),
      prisma.quotation.count({ where: { status: 'approved' } }),
      prisma.quotation.count({ where: { status: 'sent' } }),
      prisma.quotation.count({ where: { status: 'accepted' } }),
      prisma.quotation.count({ where: { status: 'declined' } }),
    ])

  const totalSent    = sentCount + acceptedCount + declinedCount
  const acceptPct    = totalSent > 0 ? Math.round((acceptedCount / totalSent) * 100) : 0

  const fmt = (n: number) =>
    n >= 1000 ? `RM ${(n / 1000).toFixed(1)}k` : `RM ${n.toFixed(0)}`

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title="Reports" />

      <main className="flex-1 p-6 space-y-8">

        {/* ── Revenue cards ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Revenue (Closed Orders)</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'This Month',  data: thisMth },
              { label: 'Last Month',  data: lastMth },
              { label: 'Year to Date', data: ytd    },
            ].map(({ label, data }) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-200 p-5">
                <p className="text-xs text-gray-400 font-medium">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(data.amount)}</p>
                <p className="text-xs text-gray-400 mt-1">{data.count} order{data.count !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Per-salesperson ────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Salesperson Performance</h2>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium text-right">Quotes</th>
                  <th className="px-4 py-3 font-medium text-right">Orders</th>
                  <th className="px-4 py-3 font-medium text-right">Conversion</th>
                  <th className="px-4 py-3 font-medium text-right">Revenue</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Margin</th>
                </tr>
              </thead>
              <tbody>
                {spStats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">
                      No salesperson data yet.
                    </td>
                  </tr>
                ) : (
                  spStats.map(sp => (
                    <tr key={sp.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{sp.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{sp.quoteCount}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{sp.orderCount}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${sp.convPct >= 50 ? 'text-green-600' : sp.convPct >= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {sp.convPct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(sp.revenue)}</td>
                      <td className="px-4 py-3 text-right">
                        {sp.avgMargin !== null ? (
                          <span className={`font-medium ${Number(sp.avgMargin) >= 20 ? 'text-green-600' : Number(sp.avgMargin) >= 12 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {sp.avgMargin}%
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Low-margin alerts ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Low-Margin Alerts
            <span className="ml-2 text-xs font-normal text-gray-400 normal-case">margin below {LOW_MARGIN_THRESHOLD}% · active quotes</span>
          </h2>

          {lowMarginItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 px-6 py-8 text-center">
              <p className="text-2xl mb-1">✅</p>
              <p className="text-sm text-gray-400">No low-margin line items in active quotes.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 font-medium">Quote</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium text-right">Sell</th>
                    <th className="px-4 py-3 font-medium text-right">Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Margin</th>
                    <th className="px-4 py-3 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {lowMarginItems.map(item => (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-red-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/quotations/${item.quotation.id}`}
                          className="font-mono text-xs font-medium text-blue-600 hover:underline"
                        >
                          {item.quotation.referenceNo}
                        </Link>
                        <p className="text-xs text-gray-400 capitalize">{item.quotation.status.replace('_', ' ')}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{item.quotation.company.name}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate" title={item.description}>
                        {item.description}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        RM {Number(item.unitPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {item.unitCost ? `RM ${Number(item.unitCost).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-red-500">
                          {item.marginPct !== null ? `${Number(item.marginPct).toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{item.quotation.createdBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Team Portfolio Intelligence ────────────────────────────────────── */}
        <TeamPortfolio />

        {/* ── Quote conversion funnel ────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quote Conversion Funnel (All Time)</h2>
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-end gap-3">
              {[
                { label: 'Draft',      count: draftCount,    color: 'bg-gray-200' },
                { label: 'Pending',    count: pendingCount,  color: 'bg-yellow-300' },
                { label: 'Approved',   count: approvedCount, color: 'bg-blue-300' },
                { label: 'Sent',       count: sentCount,     color: 'bg-purple-300' },
                { label: 'Accepted',   count: acceptedCount, color: 'bg-green-400' },
                { label: 'Declined',   count: declinedCount, color: 'bg-red-300' },
              ].map(stage => {
                const maxCount = Math.max(draftCount, pendingCount, approvedCount, sentCount, acceptedCount + declinedCount, 1)
                const barH = Math.max(8, Math.round((stage.count / maxCount) * 100))
                return (
                  <div key={stage.label} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-xs font-semibold text-gray-700">{stage.count}</p>
                    <div
                      className={`w-full rounded-t-lg ${stage.color}`}
                      style={{ height: `${barH}px` }}
                    />
                    <p className="text-xs text-gray-400 text-center leading-tight">{stage.label}</p>
                  </div>
                )
              })}
            </div>

            <p className="mt-4 text-center text-sm text-gray-500">
              Sent → Accepted: <span className={`font-bold ${acceptPct >= 60 ? 'text-green-600' : acceptPct >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>{acceptPct}%</span>
              <span className="text-gray-400 text-xs ml-2">({acceptedCount} of {totalSent} sent)</span>
            </p>
          </div>
        </section>

      </main>
    </div>
  )
}
