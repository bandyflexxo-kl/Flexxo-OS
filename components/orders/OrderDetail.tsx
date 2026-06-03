'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type OrderItem = {
  id:          string
  qty:         string
  unitPrice:   string
  lineTotal:   string
  productName: string | null
  qneItemCode: string | null
}

type StatusActivity = {
  subject:     string
  performedBy: string | null
  createdAt:   string
}

export type OrderDetailProps = {
  id:               string
  referenceNo:      string | null
  status:           string
  source:           string
  currency:         string
  totalAmount:      string | null
  customerPoNumber: string | null
  qneInvoiceRef:    string | null
  qneDoRef:         string | null
  deliveredAt:      string | null
  createdAt:        string
  company:          { id: string; name: string }
  quotation:        { id: string; referenceNo: string } | null
  createdBy:        { name: string }
  items:            OrderItem[]
  statusActivities: StatusActivity[]
  userRole:         string
}

const STATUS_STEPS = ['Confirmed', 'Processing', 'Shipped', 'Delivered'] as const
type OrderStatus = (typeof STATUS_STEPS)[number]

const STATUS_COLORS: Record<string, string> = {
  Confirmed:  'bg-blue-100 text-blue-700',
  Processing: 'bg-yellow-100 text-yellow-700',
  Shipped:    'bg-purple-100 text-purple-700',
  Delivered:  'bg-green-100 text-green-700',
}

function nextStatus(current: string): OrderStatus | null {
  const idx = STATUS_STEPS.indexOf(current as OrderStatus)
  if (idx < 0 || idx >= STATUS_STEPS.length - 1) return null
  return STATUS_STEPS[idx + 1]
}

export default function OrderDetail({ initial }: { initial: OrderDetailProps }) {
  const router = useRouter()

  const [status,      setStatus]      = useState(initial.status)
  const [poNumber,    setPoNumber]    = useState(initial.customerPoNumber ?? '')
  const [invoiceRef,  setInvoiceRef]  = useState(initial.qneInvoiceRef ?? '')
  const [doRef,       setDoRef]       = useState(initial.qneDoRef ?? '')
  const [updating,    setUpdating]    = useState(false)
  const [savingPo,    setSavingPo]    = useState(false)
  const [savingRefs,  setSavingRefs]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [doData,      setDoData]      = useState<Record<string, unknown> | null>(null)
  const [loadingDo,   setLoadingDo]   = useState(false)

  const isPrivileged = initial.userRole === 'Admin' || initial.userRole === 'Manager'
  const next         = nextStatus(status)

  async function advanceStatus() {
    if (!next) return
    setUpdating(true)
    setError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: next }),
      })
      const data = await res.json() as { ok?: boolean; status?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setStatus(data.status ?? next)
      router.refresh()
    } finally {
      setUpdating(false)
    }
  }

  async function savePo() {
    setSavingPo(true)
    try {
      await fetch(`/api/orders/${initial.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customerPoNumber: poNumber || null }),
      })
    } finally {
      setSavingPo(false)
    }
  }

  async function saveRefs() {
    setSavingRefs(true)
    try {
      await fetch(`/api/orders/${initial.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          qneInvoiceRef: invoiceRef || null,
          qneDoRef:      doRef      || null,
        }),
      })
    } finally {
      setSavingRefs(false)
    }
  }

  async function fetchDeliveryOrder() {
    setLoadingDo(true)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/qne-do`)
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) { setError((data.message as string) ?? 'Failed to fetch delivery order'); return }
      setDoData(data)
    } finally {
      setLoadingDo(false)
    }
  }

  const currentIdx = STATUS_STEPS.indexOf(status as OrderStatus)

  return (
    <div className="space-y-6 pb-16">
      {/* ── Header ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Order</p>
            <h1 className="text-2xl font-bold text-gray-900 font-mono mt-0.5">
              {initial.referenceNo ?? initial.id.slice(0, 8)}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-gray-500">
              <Link href={`/companies/${initial.company.id}`} className="hover:text-blue-600 font-medium">
                {initial.company.name}
              </Link>
              {initial.quotation && (
                <>
                  <span>·</span>
                  <span>
                    Quotation{' '}
                    <Link href={`/quotations/${initial.quotation.id}`} className="text-blue-600 hover:underline font-mono">
                      {initial.quotation.referenceNo}
                    </Link>
                  </span>
                </>
              )}
              <span>·</span>
              <span>Created by {initial.createdBy.name}</span>
              <span>·</span>
              <span>{new Date(initial.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}>
            {status}
          </span>
        </div>
      </div>

      {/* ── Status stepper ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Order Progress</h2>
        <div className="flex items-center gap-0">
          {STATUS_STEPS.map((step, idx) => (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                  idx < currentIdx
                    ? 'bg-green-500 border-green-500 text-white'
                    : idx === currentIdx
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-300 text-gray-400'
                }`}>
                  {idx < currentIdx ? '✓' : idx + 1}
                </div>
                <p className={`text-xs mt-1.5 font-medium text-center leading-tight ${
                  idx <= currentIdx ? 'text-gray-800' : 'text-gray-400'
                }`}>{step}</p>
              </div>
              {idx < STATUS_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 -mt-5 ${idx < currentIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {isPrivileged && next && status !== 'Delivered' && (
          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={advanceStatus}
              disabled={updating}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {updating ? 'Updating…' : `Mark as ${next}`}
            </button>
          </div>
        )}
        {status === 'Delivered' && initial.deliveredAt && (
          <p className="mt-4 text-sm text-green-700 font-medium">
            ✓ Delivered on {new Date(initial.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* ── Items table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-4 py-2.5 font-medium text-right w-20">Qty</th>
              <th className="px-4 py-2.5 font-medium text-right w-28">Unit Price</th>
              <th className="px-4 py-2.5 font-medium text-right w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {initial.items.map(item => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{item.productName ?? '—'}</p>
                  {item.qneItemCode && <p className="text-xs text-gray-300 font-mono">{item.qneItemCode}</p>}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{Number(item.qty).toFixed(0)}</td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {initial.currency} {Number(item.unitPrice).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {initial.currency} {Number(item.lineTotal).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total</td>
              <td className="px-4 py-3 text-right text-lg font-bold text-gray-900">
                {initial.currency} {initial.totalAmount ? Number(initial.totalAmount).toFixed(2) : '0.00'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── PO Number ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Customer PO Number</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="e.g. PO-2024-00123"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 max-w-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            onBlur={savePo}
          />
          {savingPo && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
      </div>

      {/* ── QNE References (Manager/Admin only) ── */}
      {isPrivileged && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">QNE References</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">QNE Invoice No</label>
              <input
                type="text"
                placeholder="e.g. IV-2024-00123"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={invoiceRef}
                onChange={e => setInvoiceRef(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">QNE Delivery Order No</label>
              <input
                type="text"
                placeholder="e.g. DO-2024-00123"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={doRef}
                onChange={e => setDoRef(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveRefs}
              disabled={savingRefs}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {savingRefs ? 'Saving…' : 'Save References'}
            </button>
            {doRef && (
              <button
                onClick={fetchDeliveryOrder}
                disabled={loadingDo}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {loadingDo ? 'Fetching…' : '📦 View DO from QNE'}
              </button>
            )}
          </div>

          {doData && (
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">QNE Delivery Order</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-64">
                {JSON.stringify(doData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Status history ── */}
      {initial.statusActivities.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Status History</h2>
          <div className="space-y-3">
            {initial.statusActivities.map((a, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <div className="mt-1 w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                <div>
                  <span className="font-medium text-gray-900">{a.subject}</span>
                  {a.performedBy && <span className="ml-1.5 text-xs text-gray-400">by {a.performedBy}</span>}
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(a.createdAt).toLocaleDateString('en-MY', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
