import { notFound, redirect } from 'next/navigation'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'

export default async function QuotationPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const { id } = await params

  const q = await prisma.quotation.findUnique({
    where:   { id },
    include: {
      company:   { select: { name: true, generalEmail: true, mainPhone: true } },
      contact:   { select: { name: true, email: true } },
      createdBy: { select: { name: true } },
      items: {
        include: { product: { select: { name: true, qneItemCode: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!q || q.status === 'cart') notFound()

  const denied = await assertCompanyAccess(q.companyId, session)
  if (denied) redirect('/quotations')

  const fmt = (n: string | null | undefined) =>
    n ? `${q.currency} ${Number(n).toFixed(2)}` : '—'

  return (
    <>
      {/* Auto-trigger print on load */}
      <script dangerouslySetInnerHTML={{ __html: 'window.onload = function(){ window.print() }' }} />

      <div className="max-w-3xl mx-auto p-8 print:p-0 font-sans text-gray-900 text-sm">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 print:mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-700 print:text-blue-700">Flexxo (KL) Sdn Bhd</h1>
            <p className="text-xs text-gray-500 mt-0.5">Office Supplies · Malaysia</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">Quotation</p>
            <p className="text-xl font-bold font-mono">{q.referenceNo}</p>
            <p className="text-xs text-gray-500 mt-1">
              Date: {q.createdAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            {q.expiresAt && (
              <p className="text-xs text-amber-600 font-medium mt-0.5">
                Valid until: {q.expiresAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {/* Bill To */}
        <div className="mb-8 print:mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Bill To</p>
          <p className="font-semibold text-base">{q.company.name}</p>
          {q.contact && <p className="text-gray-600">Attn: {q.contact.name}</p>}
          {q.company.generalEmail && <p className="text-gray-500 text-xs mt-0.5">{q.company.generalEmail}</p>}
        </div>

        {/* Items table */}
        <table className="w-full border-collapse mb-6 print:mb-4">
          <thead>
            <tr className="bg-gray-800 print:bg-gray-800 text-white">
              <th className="text-left px-3 py-2 text-xs font-semibold w-8">#</th>
              <th className="text-left px-3 py-2 text-xs font-semibold">Description</th>
              <th className="text-right px-3 py-2 text-xs font-semibold w-16">Qty</th>
              <th className="text-right px-3 py-2 text-xs font-semibold w-24">Unit Price</th>
              <th className="text-right px-3 py-2 text-xs font-semibold w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((item, i) => (
              <tr key={item.id} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                <td className="px-3 py-2">
                  <p className="font-medium">{item.description}</p>
                  {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                  {item.product?.qneItemCode && (
                    <p className="text-xs text-gray-300 font-mono">{item.product.qneItemCode}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {Number(item.qty).toFixed(0)} {item.unit ?? ''}
                </td>
                <td className="px-3 py-2 text-right">{fmt(item.unitPrice.toString())}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmt(item.lineTotal.toString())}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {q.discountAmount && Number(q.discountAmount) > 0 && (
              <>
                <tr className="border-t border-gray-200">
                  <td colSpan={4} className="px-3 py-1.5 text-right text-gray-500 text-xs">Subtotal</td>
                  <td className="px-3 py-1.5 text-right text-xs">{fmt(q.subtotal?.toString())}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-green-700 text-xs">Discount</td>
                  <td className="px-3 py-1.5 text-right text-green-700 text-xs">
                    − {fmt(q.discountAmount.toString())}
                  </td>
                </tr>
              </>
            )}
            <tr className="border-t-2 border-gray-800 bg-gray-50">
              <td colSpan={4} className="px-3 py-3 text-right font-bold text-sm">Total</td>
              <td className="px-3 py-3 text-right font-bold text-base text-blue-700">
                {fmt(q.totalAmount?.toString())}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Terms */}
        {q.termsConditions && (
          <div className="mb-6 print:mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Terms &amp; Conditions</p>
            <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{q.termsConditions}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 flex justify-between items-end text-xs text-gray-400">
          <div>
            <p className="font-medium text-gray-600">Prepared by: {q.createdBy.name}</p>
            <p className="mt-0.5">Flexxo (KL) Sdn Bhd</p>
          </div>
          <div className="text-right">
            <p>This quotation was generated by Flexxo Sales OS.</p>
            <p>Please contact your sales representative for any queries.</p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </>
  )
}
