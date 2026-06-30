import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { notFound } from 'next/navigation'

/** Read-only view of a QNE-synced quotation (the customer's historical quotes). */
export default async function QneQuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getOptionalShopSession()
  if (!session?.customerCompanyId) return null
  const { id } = await params

  const q = await prisma.qneQuotation.findFirst({
    where:  { id, companyId: session.customerCompanyId },   // scoped to the logged-in company
    select: {
      docNo: true, docDate: true, expiryDate: true, totalAmount: true,
      items: { select: { stockCode: true, description: true, qty: true, unitPrice: true } },
    },
  })
  if (!q) notFound()

  const fmtDate = (d: Date | null) => d ? new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
  const money   = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-5 max-w-3xl">
      <Link href="/shop/quotations" className="text-sm text-green-600 hover:underline">← Back to My Quotations</Link>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900 font-mono">{q.docNo}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Dated {fmtDate(q.docDate)}{q.expiryDate ? ` · valid until ${fmtDate(q.expiryDate)}` : ''}
            </p>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 shrink-0">On record</span>
        </div>

        {q.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">Line items for this quotation aren&apos;t available.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                <th className="px-4 py-2.5 font-medium text-right">Unit Price</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {q.items.map((it, i) => {
                const qty = Number(it.qty), price = Number(it.unitPrice)
                return (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{it.stockCode ?? ''}</td>
                    <td className="px-4 py-2.5 text-gray-800">{it.description}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{qty}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{money(price)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 tabular-nums">{money(qty * price)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total</p>
            <p className="text-xl font-bold text-gray-900 tabular-nums">MYR {money(Number(q.totalAmount))}</p>
          </div>
        </div>
      </div>

      <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-800">
        Want to reorder these items or get an updated quote? Browse the{' '}
        <Link href="/shop/products" className="font-semibold underline">catalogue</Link>{' '}or message your account manager from the dashboard.
      </div>
    </div>
  )
}
