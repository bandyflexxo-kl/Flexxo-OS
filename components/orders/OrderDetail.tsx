'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { STATUS_COLORS, getStatusSteps } from '@/lib/orderStatus'

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

type InvoiceInfo = {
  id:           string
  invoiceNo:    string
  issuedAt:     string
  qnePushStatus: string
  totalAmount:  string
} | null

type WarehouseTaskInfo = {
  id:          string
  status:      string
  completedAt: string | null
  completedBy: string | null
} | null

type DeliveryBookingInfo = {
  id:               string
  bookingStatus:    string
  serviceType:      string | null
  quotedPriceMyr:   string | null
  shareLink:        string | null
  driverName:       string | null
  driverPhone:      string | null
  plateNumber:      string | null
  bookedAt:         string | null
  retryCount:       number
} | null

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
  invoice:          InvoiceInfo
  warehouseTask:    WarehouseTaskInfo
  deliveryBooking:  DeliveryBookingInfo
}

export default function OrderDetail({ initial }: { initial: OrderDetailProps }) {
  const router = useRouter()

  const [status,        setStatus]        = useState(initial.status)
  const [poNumber,      setPoNumber]      = useState(initial.customerPoNumber ?? '')
  const [invoiceRef,    setInvoiceRef]    = useState(initial.qneInvoiceRef ?? '')
  const [doRef,         setDoRef]         = useState(initial.qneDoRef ?? '')
  const [invoice,       setInvoice]       = useState(initial.invoice)
  const [delivery,      setDelivery]      = useState(initial.deliveryBooking)
  const [approving,     setApproving]     = useState(false)
  const [booking,       setBooking]       = useState(false)
  const [readying,      setReadying]      = useState(false)
  const [collecting,    setCollecting]    = useState(false)
  const [delivering,    setDelivering]    = useState(false)
  const [savingPo,      setSavingPo]      = useState(false)
  const [savingRefs,    setSavingRefs]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [doData,        setDoData]        = useState<Record<string, unknown> | null>(null)
  const [loadingDo,     setLoadingDo]     = useState(false)

  type QuoteData = {
    quoteId:     string
    serviceType: string
    priceMyr:    number
    expiresAt:   string
    bookingTime: { scheduleAt: string; isScheduled: boolean; label: string }
    surge:       { isSurge: boolean; baselineMyr: number; label: string }
    dropoff:     { name: string; phone: string; address: string }
  }
  const [quotePhase,  setQuotePhase]  = useState<'idle' | 'fetching' | 'ready' | 'booking'>('idle')
  const [quoteData,   setQuoteData]   = useState<QuoteData | null>(null)
  const [quoteError,  setQuoteError]  = useState<string | null>(null)

  // Director / SuperAdmin are top management — full order actions in the UI too
  // (the order APIs already allow them via isPrivilegedRole).
  const isPrivileged = ['Admin', 'Manager', 'Director', 'SuperAdmin'].includes(initial.userRole)
  const statusSteps  = getStatusSteps(status)
  const currentIdx   = statusSteps.indexOf(status)

  // ── Approve order ──────────────────────────────────────────────────────────
  async function approveOrder() {
    setApproving(true)
    setError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json() as { ok?: boolean; invoiceNo?: string; invoiceId?: string; warehouseTaskId?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Approve failed'); return }
      setStatus('Approved')
      setInvoice(prev => prev ?? {
        id:            data.invoiceId ?? '',
        invoiceNo:     data.invoiceNo ?? '',
        issuedAt:      new Date().toISOString(),
        qnePushStatus: 'pending',
        totalAmount:   initial.totalAmount ?? '0',
      })
      router.refresh()
    } finally {
      setApproving(false)
    }
  }

  // ── Step 1: fetch Lalamove quote preview ─────────────────────────────────
  async function fetchQuote() {
    setQuotePhase('fetching')
    setQuoteError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/delivery-quote`)
      const data = await res.json() as QuoteData & { error?: string }
      if (!res.ok) { setQuoteError(data.error ?? 'Could not get quote'); setQuotePhase('idle'); return }
      setQuoteData(data)
      setQuotePhase('ready')
    } catch {
      setQuoteError('Network error — please try again')
      setQuotePhase('idle')
    }
  }

  // ── Step 2: confirm and book ──────────────────────────────────────────────
  async function bookDelivery(useQuote?: QuoteData) {
    setQuotePhase('booking')
    setBooking(true)
    setError(null)
    try {
      const body = useQuote
        ? JSON.stringify({ quoteId: useQuote.quoteId, serviceType: useQuote.serviceType, priceMyr: useQuote.priceMyr })
        : undefined
      const res  = await fetch(`/api/orders/${initial.id}/book-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const data = await res.json() as { ok?: boolean; shareLink?: string; error?: string }
      if (!res.ok) {
        const msg = data.error ?? 'Booking failed'
        // Quote may have expired — reset to idle so admin can re-quote
        if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('quote')) {
          setQuoteData(null)
          setQuotePhase('idle')
          setError(msg + ' — please get a new quote.')
        } else {
          setError(msg)
          setQuotePhase('ready')
        }
        return
      }
      setStatus('Delivering')
      setDelivery(prev => prev ? { ...prev, bookingStatus: 'booked', shareLink: data.shareLink ?? null } : prev)
      setQuotePhase('idle')
      setQuoteData(null)
      router.refresh()
    } finally {
      setBooking(false)
    }
  }

  // ── Mark ReadyToCollect ───────────────────────────────────────────────────
  async function markReadyToCollect() {
    setReadying(true)
    setError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/ready-to-collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setStatus('ReadyToCollect')
      router.refresh()
    } finally {
      setReadying(false)
    }
  }

  // ── Mark Collected ────────────────────────────────────────────────────────
  async function markCollected() {
    setCollecting(true)
    setError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/collected`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setStatus('Collected')
      router.refresh()
    } finally {
      setCollecting(false)
    }
  }

  // ── Mark Delivering (manual, no Lalamove) ─────────────────────────────────
  async function markDelivering() {
    setDelivering(true)
    setError(null)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/mark-delivering`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setStatus('Delivering')
      router.refresh()
    } finally {
      setDelivering(false)
    }
  }

  async function savePo() {
    setSavingPo(true)
    try {
      await fetch(`/api/orders/${initial.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerPoNumber: poNumber || null }),
      })
    } finally { setSavingPo(false) }
  }

  async function saveRefs() {
    setSavingRefs(true)
    try {
      await fetch(`/api/orders/${initial.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qneInvoiceRef: invoiceRef || null, qneDoRef: doRef || null }),
      })
    } finally { setSavingRefs(false) }
  }

  async function fetchDeliveryOrder() {
    setLoadingDo(true)
    try {
      const res  = await fetch(`/api/orders/${initial.id}/qne-do`)
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) { setError((data.message as string) ?? 'Failed'); return }
      setDoData(data)
    } finally { setLoadingDo(false) }
  }

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
              <span>By {initial.createdBy.name}</span>
              <span>·</span>
              <span>{new Date(initial.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}>
            {status}
          </span>
        </div>
      </div>

      {/* ── Approve button (Confirmed only) ── */}
      {isPrivileged && status === 'Confirmed' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold text-amber-900 text-sm">Action required — review and approve this order</p>
            <p className="text-xs text-amber-700 mt-0.5">Approving will issue an invoice and send a picking task to the warehouse.</p>
          </div>
          {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          <button
            onClick={approveOrder}
            disabled={approving}
            className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm rounded-xl disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {approving ? 'Approving…' : '✓ Approve Order'}
          </button>
        </div>
      )}

      {/* ── Status stepper ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Order Progress</h2>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {statusSteps.map((step, idx) => (
            <div key={step} className="flex items-center flex-1 last:flex-none min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 transition-colors ${
                  idx < currentIdx  ? 'bg-green-500 border-green-500 text-white'
                  : idx === currentIdx ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-400'
                }`}>
                  {idx < currentIdx ? '✓' : idx + 1}
                </div>
                <p className={`text-xs mt-1 font-medium text-center leading-tight px-0.5 ${idx <= currentIdx ? 'text-gray-800' : 'text-gray-400'}`}>
                  {step}
                </p>
              </div>
              {idx < statusSteps.length - 1 && (
                <div className={`h-0.5 flex-1 mx-0.5 -mt-5 shrink-0 ${idx < currentIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {(status === 'Delivered' || status === 'Collected') && initial.deliveredAt && (
          <p className="mt-4 text-sm text-green-700 font-medium">
            ✓ {status === 'Collected' ? 'Collected' : 'Delivered'}{' '}
            {new Date(initial.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}

        {/* Fulfilment method buttons when Packed */}
        {isPrivileged && status === 'Packed' && (
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* ── Quote preview panel ── */}
            {quotePhase === 'ready' && quoteData ? (
              <div className={`rounded-xl border p-4 space-y-3 ${quoteData.surge.isSurge ? 'border-yellow-300 bg-yellow-50' : 'border-purple-200 bg-purple-50'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="font-semibold text-gray-900 text-sm">🚗 Lalamove Quote</p>
                  {quoteData.surge.isSurge && (
                    <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">⚡ Surge Pricing</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Service</p>
                    <p className="font-medium">{quoteData.serviceType}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Price</p>
                    <p className={`font-bold text-base ${quoteData.surge.isSurge ? 'text-yellow-700' : 'text-purple-700'}`}>
                      MYR {quoteData.priceMyr.toFixed(2)}
                    </p>
                    {quoteData.surge.isSurge && (
                      <p className="text-xs text-yellow-600">{quoteData.surge.label}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Pickup time</p>
                    <p className="font-medium text-sm">{quoteData.bookingTime.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Deliver to</p>
                    <p className="font-medium text-sm truncate">{quoteData.dropoff.name}</p>
                    <p className="text-xs text-gray-400 truncate">{quoteData.dropoff.address}</p>
                  </div>
                </div>
                {quoteData.surge.isSurge && (
                  <p className="text-xs text-yellow-700 bg-yellow-100 rounded-lg px-3 py-2">
                    ⚡ Surge detected. Normal price ~RM {quoteData.surge.baselineMyr.toFixed(0)}. You can confirm anyway or try again during off-peak hours.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => bookDelivery(quoteData)}
                    disabled={booking}
                    className={`px-4 py-2 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors ${
                      quoteData.surge.isSurge
                        ? 'bg-yellow-500 hover:bg-yellow-600'
                        : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                  >
                    {booking ? 'Booking…' : quoteData.surge.isSurge ? '⚡ Confirm Anyway' : '✓ Confirm Booking'}
                  </button>
                  <button
                    onClick={() => { setQuoteData(null); setQuotePhase('idle') }}
                    disabled={booking}
                    className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Choose fulfilment method</p>
                {quoteError && <p className="text-sm text-red-600">{quoteError}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={fetchQuote}
                    disabled={quotePhase === 'fetching' || readying || delivering}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {quotePhase === 'fetching' ? 'Getting quote…' : '🚗 Get Lalamove Quote'}
                  </button>
                  <button
                    onClick={markDelivering}
                    disabled={quotePhase === 'fetching' || readying || delivering}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {delivering ? 'Updating…' : '🚚 Manual Delivery'}
                  </button>
                  <button
                    onClick={markReadyToCollect}
                    disabled={quotePhase === 'fetching' || readying || delivering}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {readying ? 'Updating…' : '🏪 Self-Collection'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">Lalamove: shows price + pickup time before confirming. Avoids lunch hours (12–2 PM) and after 5 PM automatically.</p>
              </>
            )}
          </div>
        )}

        {/* Confirm collection when ReadyToCollect */}
        {isPrivileged && status === 'ReadyToCollect' && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <button
              onClick={markCollected}
              disabled={collecting}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
            >
              {collecting ? 'Confirming…' : '✅ Confirm Collected'}
            </button>
            <p className="text-xs text-gray-400 mt-1.5">Click when customer has collected the goods in person.</p>
          </div>
        )}
      </div>

      {/* ── Invoice Panel ── */}
      {invoice && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Invoice</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              invoice.qnePushStatus === 'pushed'  ? 'bg-green-100 text-green-700' :
              invoice.qnePushStatus === 'failed'  ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              QNE: {invoice.qnePushStatus}
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-400">Invoice No</p>
              <p className="font-mono font-semibold text-gray-900">{invoice.invoiceNo}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Amount</p>
              <p className="font-semibold text-gray-900">{initial.currency} {Number(invoice.totalAmount).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Issued</p>
              <p className="text-gray-700">{new Date(invoice.issuedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Warehouse Task Panel ── */}
      {initial.warehouseTask && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Warehouse Task</h2>
          <div className="flex items-center gap-3 text-sm">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              initial.warehouseTask.status === 'done'        ? 'bg-green-100 text-green-700' :
              initial.warehouseTask.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {initial.warehouseTask.status}
            </span>
            {initial.warehouseTask.completedAt && (
              <span className="text-gray-500">
                Completed {new Date(initial.warehouseTask.completedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {initial.warehouseTask.completedBy && ` by ${initial.warehouseTask.completedBy}`}
              </span>
            )}
            {initial.warehouseTask.status === 'pending' && (
              <Link href="/warehouse" className="text-blue-600 hover:underline text-xs">View in Warehouse →</Link>
            )}
          </div>
        </div>
      )}

      {/* ── Delivery Booking Panel ── */}
      {delivery && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Delivery (Lalamove)</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              delivery.bookingStatus === 'completed'       ? 'bg-green-100 text-green-700' :
              delivery.bookingStatus === 'driver_assigned' ? 'bg-blue-100 text-blue-700' :
              delivery.bookingStatus === 'booked'          ? 'bg-purple-100 text-purple-700' :
              delivery.bookingStatus === 'failed'          ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              {delivery.bookingStatus}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {delivery.serviceType && (
              <div><p className="text-xs text-gray-400">Service</p><p className="font-medium">{delivery.serviceType}</p></div>
            )}
            {delivery.quotedPriceMyr && (
              <div><p className="text-xs text-gray-400">Price</p><p className="font-medium">MYR {Number(delivery.quotedPriceMyr).toFixed(2)}</p></div>
            )}
            {delivery.driverName && (
              <div><p className="text-xs text-gray-400">Driver</p><p className="font-medium">{delivery.driverName}</p></div>
            )}
            {delivery.driverPhone && (
              <div><p className="text-xs text-gray-400">Driver Phone</p><p className="font-medium">{delivery.driverPhone}</p></div>
            )}
            {delivery.plateNumber && (
              <div><p className="text-xs text-gray-400">Plate</p><p className="font-mono font-medium">{delivery.plateNumber}</p></div>
            )}
            {delivery.retryCount > 0 && (
              <div><p className="text-xs text-gray-400">Retries</p><p className="font-medium text-red-600">{delivery.retryCount}</p></div>
            )}
          </div>
          {delivery.shareLink && (
            <a
              href={delivery.shareLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
            >
              🔗 Track Delivery
            </a>
          )}
          {isPrivileged && status === 'Packed' && (
            <button
              onClick={fetchQuote}
              disabled={quotePhase === 'fetching'}
              className="px-4 py-1.5 text-xs rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50 transition-colors"
            >
              {quotePhase === 'fetching' ? 'Getting quote…' : '🚗 Retry Booking'}
            </button>
          )}
        </div>
      )}

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
                <td className="px-4 py-3 text-right text-gray-700">{initial.currency} {Number(item.unitPrice).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{initial.currency} {Number(item.lineTotal).toFixed(2)}</td>
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
              <input type="text" placeholder="e.g. IV-2024-00123" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">QNE Delivery Order No</label>
              <input type="text" placeholder="e.g. DO-2024-00123" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" value={doRef} onChange={e => setDoRef(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveRefs} disabled={savingRefs} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {savingRefs ? 'Saving…' : 'Save References'}
            </button>
            {doRef && (
              <button onClick={fetchDeliveryOrder} disabled={loadingDo} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {loadingDo ? 'Fetching…' : '📦 View DO from QNE'}
              </button>
            )}
          </div>
          {doData && (
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">QNE Delivery Order</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-64">{JSON.stringify(doData, null, 2)}</pre>
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
                    {new Date(a.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
