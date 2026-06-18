'use client'

/**
 * ReorderModal — opens a pre-filled quotation form when the client clicks "Reorder".
 * The client can adjust quantities per item before submitting to cart.
 *
 * Flow:
 *   1. Click "Reorder" → GET /api/portal/orders/[id]/reorder → open modal
 *   2. Edit quantities (set to 0 to skip an item)
 *   3. Click "Submit Quotation" → POST /api/portal/orders/[id]/reorder { lines: [{itemId, qty}] }
 *   4. Redirect to /shop/cart
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import FlexxoSpinner from './FlexxoSpinner'

interface OrderLine {
  itemId:      string        // OrderItem.id — primary key for this modal
  productId:   string | null // null = no CRM catalogue match
  name:        string
  description: string
  brand:       string | null
  unit:        string | null
  qty:         number
  unitPrice:   number
  lineTotal:   number
  repriced:    boolean       // true = live current price; false = original order price
}

interface ReorderPreview {
  orderId:     string
  referenceNo: string | null
  lines:       OrderLine[]
  currency:    string
}

type ButtonState = 'idle' | 'loading-preview' | 'error-preview'

export default function ReorderModal({ orderId }: { orderId: string }) {
  const router = useRouter()

  const [btnState,   setBtnState]   = useState<ButtonState>('idle')
  const [preview,    setPreview]    = useState<ReorderPreview | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({}) // keyed by itemId
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === modalRef.current) closeModal()
  }, [])

  useEffect(() => {
    if (!preview) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [preview])

  function closeModal() {
    setPreview(null)
    setQuantities({})
    setSubmitError(null)
    setBtnState('idle')
  }

  async function openModal() {
    if (btnState !== 'idle') return
    setBtnState('loading-preview')
    try {
      const res  = await fetch(`/api/portal/orders/${orderId}/reorder`)
      const data = await res.json() as ReorderPreview & { error?: string }
      if (!res.ok || data.error) {
        setBtnState('error-preview')
        setTimeout(() => setBtnState('idle'), 3000)
        return
      }
      const initQty: Record<string, number> = {}
      data.lines.forEach(l => { initQty[l.itemId] = l.qty })
      setQuantities(initQty)
      setPreview(data)
      setBtnState('idle')
    } catch {
      setBtnState('error-preview')
      setTimeout(() => setBtnState('idle'), 3000)
    }
  }

  function setQty(itemId: string, value: number) {
    setQuantities(prev => ({ ...prev, [itemId]: Math.max(0, value) }))
  }

  const lines      = preview?.lines ?? []
  const currency   = preview?.currency ?? 'MYR'
  const activeLines = lines.filter(l => (quantities[l.itemId] ?? l.qty) > 0)
  const grandTotal  = lines.reduce((sum, l) => {
    const qty = quantities[l.itemId] ?? l.qty
    return sum + (qty > 0 ? l.unitPrice * qty : 0)
  }, 0)

  async function handleSubmit() {
    if (!preview || submitting) return
    setSubmitError(null)

    const submitLines = lines
      .map(l => ({ itemId: l.itemId, qty: quantities[l.itemId] ?? l.qty }))
      .filter(l => l.qty > 0)

    if (submitLines.length === 0) {
      setSubmitError('Please keep at least one item with quantity > 0.')
      return
    }

    setSubmitting(true)
    try {
      const res  = await fetch(`/api/portal/orders/${orderId}/reorder`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lines: submitLines }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setSubmitError(data.error ?? 'Failed to add to cart. Please try again.')
        setSubmitting(false)
        return
      }
      router.push('/shop/cart')
    } catch {
      setSubmitError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={openModal}
        disabled={btnState === 'loading-preview'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all active:scale-[0.97] ${
          btnState === 'error-preview'
            ? 'border-red-200 text-red-600 bg-red-50'
            : 'border-green-200 text-green-700 hover:bg-green-50'
        }`}
      >
        {btnState === 'loading-preview' ? (
          <><FlexxoSpinner size="xs" color="green" /> Loading…</>
        ) : btnState === 'error-preview' ? (
          '✗ Failed, retry'
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
            </svg>
            Reorder
          </>
        )}
      </button>

      {/* Modal */}
      {preview && (
        <div
          ref={modalRef}
          onClick={handleBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Reorder Items</h2>
                {preview.referenceNo && (
                  <p className="text-xs text-gray-400 mt-0.5">From {preview.referenceNo} · adjust quantities below</p>
                )}
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Items list */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2">
              {lines.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No items found in this order.</p>
              )}
              {lines.map(line => {
                const qty       = quantities[line.itemId] ?? line.qty
                const lineTotal = line.unitPrice * qty
                const removed   = qty === 0

                return (
                  <div
                    key={line.itemId}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                      removed ? 'border-gray-100 bg-gray-50 opacity-40' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{line.description || line.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {currency} {line.unitPrice.toFixed(2)} / {line.unit ?? 'pc'}
                        {line.brand && <span className="ml-2 text-gray-300">· {line.brand}</span>}
                        {!line.repriced && (
                          <span className="ml-2 text-amber-400">· original price</span>
                        )}
                      </p>
                    </div>

                    {/* Qty stepper */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setQty(line.itemId, qty - 1)}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm font-medium transition-colors"
                      >−</button>
                      <input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={e => setQty(line.itemId, parseInt(e.target.value, 10) || 0)}
                        className="w-14 text-center border border-gray-200 rounded-lg py-1 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <button
                        onClick={() => setQty(line.itemId, qty + 1)}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm font-medium transition-colors"
                      >+</button>
                    </div>

                    {/* Line total */}
                    <div className="w-24 text-right shrink-0">
                      {removed ? (
                        <span className="text-xs text-gray-300">Removed</span>
                      ) : (
                        <span className="text-sm font-semibold text-gray-900">
                          {currency} {lineTotal.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 px-6 py-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  {activeLines.length} of {lines.length} items selected
                </span>
                <span className="font-bold text-gray-900 text-base">
                  {currency} {grandTotal.toFixed(2)}
                </span>
              </div>

              {submitError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || activeLines.length === 0}
                  className="flex-2 flex-grow-[2] py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <><FlexxoSpinner size="xs" color="white" /> Adding to cart…</>
                  ) : (
                    `Submit Quotation (${activeLines.length} item${activeLines.length !== 1 ? 's' : ''})`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
