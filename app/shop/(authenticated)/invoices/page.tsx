import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

const PAGE_CAP = 500

export default async function ShopInvoicesPage() {
  const session = await getOptionalShopSession()
  if (!session?.customerCompanyId) return null

  const [invoices, total] = await Promise.all([
    prisma.qneInvoice.findMany({
      where:   { companyId: session.customerCompanyId },
      orderBy: { docDate: 'desc' },
      take:    PAGE_CAP,
      select:  { id: true, docNo: true, docDate: true, totalAmount: true, _count: { select: { items: true } } },
    }),
    prisma.qneInvoice.count({ where: { companyId: session.customerCompanyId } }),
  ])

  const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
  const money   = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {total.toLocaleString()} invoice{total !== 1 ? 's' : ''}{total > PAGE_CAP ? ` · showing most recent ${PAGE_CAP}` : ''} · download any as PDF
          </p>
        </div>
        <Link href="/shop/dashboard" className="text-sm text-green-600 hover:underline">← Dashboard</Link>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <p className="text-5xl mb-3">🧾</p>
          <p className="text-gray-500 text-sm">No invoices yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Invoice No.</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-sm font-medium text-gray-900">{inv.docNo}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(inv.docDate)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{inv._count.items}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">MYR {money(Number(inv.totalAmount))}</td>
                  <td className="px-4 py-2.5 text-right">
                    <a href={`/api/portal/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors">
                      ⬇ PDF
                    </a>
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
