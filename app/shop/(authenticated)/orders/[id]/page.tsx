import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { toPortalStatus } from '@/lib/orderStatus'

const STEPS = ['Confirmed', 'Processing', 'Shipped', 'Delivered'] as const
type Step = (typeof STEPS)[number]

const STEP_ICON: Record<Step, string> = {
  Confirmed:  '✅',
  Processing: '⚙️',
  Shipped:    '🚚',
  Delivered:  '🎉',
}

const STEP_DESC: Record<Step, string> = {
  Confirmed:  'We\'ve received your order.',
  Processing: 'Your order is being prepared.',
  Shipped:    'Your order is on the way.',
  Delivered:  'Your order has been delivered.',
}

export default async function ShopOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id }   = await params
  const session  = await getOptionalSession()
  if (!session?.customerCompanyId) return null

  const order = await prisma.order.findUnique({
    where:  { id },
    select: {
      id: true, referenceNo: true, status: true,
      currency: true, totalAmount: true, createdAt: true, deliveredAt: true,
      qneDoRef: true,
      companyId: true,
      quotation: { select: { id: true, referenceNo: true } },
      items: {
        select: {
          id: true, qty: true, unitPrice: true, lineTotal: true,
          product: { select: { name: true, brand: true, unit: true } },
        },
      },
    },
  })

  if (!order || order.companyId !== session.customerCompanyId) notFound()

  // Map internal pipeline statuses to the simplified 4-step portal view
  const portalStatus   = toPortalStatus(order.status) as Step
  const currentStepIdx = STEPS.indexOf(portalStatus)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/shop/orders" className="text-xs text-blue-600 hover:underline">← My Orders</Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">
            {order.referenceNo ?? order.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-gray-400">
            Placed {new Date(order.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
            {order.quotation && (
              <> · Quotation: <Link href={`/shop/quotations/${order.quotation.id}`} className="text-blue-600 hover:underline">{order.quotation.referenceNo}</Link></>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Total</p>
          <p className="text-lg font-bold text-gray-900">
            {order.totalAmount ? `${order.currency} ${Number(order.totalAmount).toFixed(2)}` : '—'}
          </p>
        </div>
      </div>

      {/* Status stepper */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-2">
          {STEPS.map((step, i) => {
            const isDone    = i <= currentStepIdx
            const isCurrent = i === currentStepIdx
            return (
              <div key={step} className="flex-1 flex flex-col items-center text-center gap-1">
                {/* Connector line */}
                <div className="relative w-full flex items-center justify-center">
                  {/* Left line */}
                  {i > 0 && (
                    <div className={`absolute right-1/2 top-4 w-1/2 h-0.5 ${i <= currentStepIdx ? 'bg-blue-500' : 'bg-gray-200'}`} />
                  )}
                  {/* Right line */}
                  {i < STEPS.length - 1 && (
                    <div className={`absolute left-1/2 top-4 w-1/2 h-0.5 ${i < currentStepIdx ? 'bg-blue-500' : 'bg-gray-200'}`} />
                  )}
                  {/* Circle */}
                  <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 ${
                    isCurrent
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : isDone
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-300'
                  }`}>
                    {isDone ? STEP_ICON[step] : <span className="text-xs">{i + 1}</span>}
                  </div>
                </div>
                <p className={`text-xs font-medium mt-1 ${isCurrent ? 'text-blue-700' : isDone ? 'text-gray-700' : 'text-gray-300'}`}>
                  {step}
                </p>
                {isCurrent && (
                  <p className="text-xs text-gray-400 leading-tight">{STEP_DESC[step]}</p>
                )}
              </div>
            )
          })}
        </div>

        {/* DO reference */}
        {order.qneDoRef && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Delivery Order: <span className="font-mono font-medium text-gray-600">{order.qneDoRef}</span>
          </p>
        )}
        {order.deliveredAt && (
          <p className="mt-1 text-center text-xs text-green-600">
            Delivered on {new Date(order.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Order Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Unit Price</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map(item => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{item.product?.name ?? 'Product'}</p>
                  {item.product?.brand && (
                    <p className="text-xs text-gray-400">{item.product.brand}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {Number(item.qty)} {item.product?.unit ?? ''}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {order.currency} {Number(item.unitPrice).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {order.currency} {Number(item.lineTotal).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td colSpan={3} className="px-4 py-3 text-right font-semibold text-gray-700 text-sm">Total</td>
              <td className="px-4 py-3 text-right font-bold text-gray-900">
                {order.currency} {Number(order.totalAmount ?? 0).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Help */}
      <p className="text-center text-xs text-gray-400 pb-4">
        Questions about this order? Contact your Flexxo sales representative.
      </p>
    </div>
  )
}
