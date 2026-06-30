import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

/**
 * /shop/spending — month-by-month spend breakdown for a B2B customer.
 * Computed entirely from the DB-cached QNE invoices (qne_invoices), so it
 * works without the Radmin VPN. Linked from the dashboard "Total Spent" card.
 */
export default async function SpendingPage() {
  const session = await getOptionalShopSession()
  if (!session?.customerCompanyId) return null

  const invoices = await prisma.qneInvoice.findMany({
    where:   { companyId: session.customerCompanyId },
    select:  { docDate: true, totalAmount: true },
    orderBy: { docDate: 'asc' },
  })

  // Group by calendar month (YYYY-MM)
  const byMonth = new Map<string, { total: number; count: number }>()
  for (const inv of invoices) {
    const d   = new Date(inv.docDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const cur = byMonth.get(key) ?? { total: 0, count: 0 }
    cur.total += Number(inv.totalAmount)
    cur.count += 1
    byMonth.set(key, cur)
  }

  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const [y, m] = key.split('-')
      const label  = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' })
      return { key, label, ...v }
    })

  const grandTotal = invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
  const maxMonth   = Math.max(...months.map(m => m.total), 1)
  const avgMonth   = months.length ? grandTotal / months.length : 0
  const money      = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const rangeLabel = invoices.length
    ? `${new Date(invoices[0].docDate).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })} – ${new Date(invoices[invoices.length - 1].docDate).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}`
    : '—'

  // Show the chart for the most recent 24 months so it stays readable.
  const chartMonths = months.slice(-24)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Spending breakdown</h1>
          <p className="text-xs text-gray-400 mt-0.5">{rangeLabel} · {invoices.length.toLocaleString()} invoices</p>
        </div>
        <Link href="/shop/dashboard" className="text-sm text-green-600 hover:underline">← Dashboard</Link>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <p className="text-5xl mb-3">📊</p>
          <p className="text-gray-500 text-sm">No spending history yet.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-400 font-medium">Total Spent</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">MYR {money(grandTotal)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-400 font-medium">Avg / Month</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">MYR {money(avgMonth)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs text-gray-400 font-medium">Months</p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">{months.length}</p>
            </div>
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Monthly spend{chartMonths.length < months.length ? ' (last 24 months)' : ''}</p>
            <div className="flex items-end gap-1.5 h-48 overflow-x-auto">
              {chartMonths.map(m => (
                <div key={m.key} className="flex flex-col items-center justify-end flex-1 min-w-[24px] group">
                  <div className="relative w-full flex justify-center">
                    <div
                      className="w-full max-w-[28px] bg-green-400 group-hover:bg-green-500 rounded-t transition-colors"
                      style={{ height: `${Math.max(2, Math.round((m.total / maxMonth) * 168))}px` }}
                      title={`${m.label}: MYR ${money(m.total)} (${m.count} inv)`}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 mt-1 rotate-0 whitespace-nowrap">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly table (most recent first) */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium text-right">Invoices</th>
                  <th className="px-4 py-3 font-medium text-right">Spent</th>
                  <th className="px-4 py-3 font-medium text-right">% of total</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map(m => (
                  <tr key={m.key} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{m.label}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{m.count}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">MYR {money(m.total)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">{grandTotal ? ((m.total / grandTotal) * 100).toFixed(1) : '0'}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-900">Total</td>
                  <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{invoices.length}</td>
                  <td className="px-4 py-3 text-right text-gray-900 tabular-nums">MYR {money(grandTotal)}</td>
                  <td className="px-4 py-3 text-right text-gray-400">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
