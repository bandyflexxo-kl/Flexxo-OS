'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type QuotationItem = {
  id:          string
  description: string
  brand:       string | null
  unit:        string | null
  qty:         string
  unitPrice:   string
  lineTotal:   string
  product:     { id: string; name: string } | null
}

type Quotation = {
  id:              string
  referenceNo:     string
  status:          string
  currency:        string
  totalAmount:     string | null
  poNumber:        string | null
  costCentre:      string | null
  termsConditions: string | null
  sentAt:          string | null
  expiresAt:       string | null
  createdAt:       string
  clientAmended:   boolean
  clientAmendedAt: string | null
  company:         { name: string }
  createdBy:       { name: string }
  items:           QuotationItem[]
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
}

export default function ShopQuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [quotation,    setQuotation]    = useState<Quotation | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [responding,   setResponding]   = useState(false)
  const [amendMode,    setAmendMode]    = useState(false)
  const [amendQtys,    setAmendQtys]    = useState<Record<string, number>>({})
  const [removedIds,   setRemovedIds]   = useState<Set<string>>(new Set())
  const [submitting,   setSubmitting]   = useState(false)
  const [amendSuccess, setAmendSuccess] = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [quotationId,  setQuotationId]  = useState<string | null>(null)

  useEffect(() => {
    params.then(({ id }) => {
      setQuotationId(id)
      fetch(`/api/portal/quotations/${id}`)
        .then(r => r.json() as Promise<Quotation>)
        .then(data => { setQuotation(data); setLoading(false) })
    })
  }, [params])

  function enterAmendMode() {
    if (!quotation) return
    const initial: Record<string, number> = {}
    quotation.items.forEach(item => { initial[item.id] = parseInt(item.qty, 10) })
    setAmendQtys(initial)
    setRemovedIds(new Set())
    setError(null)
    setAmendMode(true)
  }

  function cancelAmend() {
    setAmendMode(false)
    setError(null)
  }

  async function respond(action: 'accept' | 'decline') {
    if (!quotation) return
    setResponding(true)
    setError(null)
    try {
      const res  = await fetch(`/api/portal/quotations/${quotation.id}/respond`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setQuotation(prev => prev ? { ...prev, status: data.status ?? prev.status } : prev)
    } finally {
      setResponding(false)
    }
  }

  async function submitAmendment() {
    if (!quotation || !quotationId) return
    setSubmitting(true)
    setError(null)

    const items: { itemId: string; qty: number }[] = quotation.items
      .filter(item => !removedIds.has(item.id))
      .map(item => ({ itemId: item.id, qty: amendQtys[item.id] ?? parseInt(item.qty, 10) }))
      .concat(
        [...removedIds].map(id => ({ itemId: id, qty: 0 }))
      )

    // Validate: at least one item with qty > 0 remaining
    const remaining = items.filter(i => i.qty > 0)
    if (remaining.length === 0) {
      setError('Cannot remove all items.')
      setSubmitting(false)
      return
    }

    try {
      const res  = await fetch(`/api/portal/quotations/${quotationId}/amend`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Amendment failed'); return }

      // Refetch updated quotation
      const updated = await fetch(`/api/portal/quotations/${quotationId}`).then(r => r.json() as Promise<Quotation>)
      setQuotation(updated)
      setAmendMode(false)
      setAmendSuccess(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400 animate-pulse">Loading…</div>
  if (!quotation) return <div className="text-center py-16 text-red-500">Quotation not found.</div>

  const canAmend = quotation.status === 'sent' && !quotation.clientAmended

  // In amend mode, compute the preview total
  const amendPreviewTotal = amendMode
    ? quotation.items
        .filter(i => !removedIds.has(i.id))
        .reduce((sum, i) => sum + Number(i.unitPrice) * (amendQtys[i.id] ?? parseInt(i.qty, 10)), 0)
    : 0

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/shop/quotations" className="text-sm text-gray-500 hover:text-gray-700 inline-block">
        ← My Quotations
      </Link>

      {/* Amendment success banner */}
      {amendSuccess && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-800 font-medium">
          ✓ Your amendment has been submitted. Your Flexxo sales representative will review and update your quotation shortly.
        </div>
      )}

      {/* Already amended banner */}
      {quotation.clientAmended && !amendSuccess && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          ⚠️ You have already submitted one amendment for this quotation. Further amendments are not allowed — please contact your Flexxo sales representative directly.
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Quotation</p>
            <h1 className="text-xl font-bold text-gray-900 font-mono">{quotation.referenceNo}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Prepared by {quotation.createdBy.name} · {new Date(quotation.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[quotation.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {quotation.status.replace(/_/g, ' ')}
          </span>
        </div>
        {quotation.expiresAt && (
          <p className="text-xs text-amber-600 mt-3 font-medium">
            ⏱ Expires: {new Date(quotation.expiresAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
        {(quotation.poNumber || quotation.costCentre) && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-4 text-sm">
            {quotation.poNumber && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">PO Number</p>
                <p className="font-mono font-medium text-gray-800">{quotation.poNumber}</p>
              </div>
            )}
            {quotation.costCentre && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Remark</p>
                <p className="font-medium text-gray-800">{quotation.costCentre}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Amend mode warning */}
      {amendMode && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-sm text-amber-800 font-medium">
          ⚠️ You can only submit one amendment. Once submitted, further changes are not allowed — make sure your quantities are correct before confirming.
        </div>
      )}

      {/* Items table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium text-right">Unit Price</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
              {amendMode && <th className="px-4 py-3 font-medium text-center">Remove</th>}
            </tr>
          </thead>
          <tbody>
            {quotation.items.map(item => {
              const isRemoved = removedIds.has(item.id)
              const editQty   = amendMode ? (amendQtys[item.id] ?? parseInt(item.qty, 10)) : parseInt(item.qty, 10)
              const lineTotal = amendMode && !isRemoved ? Number(item.unitPrice) * editQty : Number(item.lineTotal)
              return (
                <tr key={item.id} className={`border-b border-gray-50 ${isRemoved ? 'opacity-40 line-through' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.description}</p>
                    {item.brand && <p className="text-xs text-gray-400">{item.brand}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {amendMode && !isRemoved ? (
                      <input
                        type="number"
                        min={1}
                        value={editQty}
                        onChange={e => {
                          const v = Math.max(1, parseInt(e.target.value, 10) || 1)
                          setAmendQtys(prev => ({ ...prev, [item.id]: v }))
                        }}
                        className="w-16 text-right border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums"
                      />
                    ) : (
                      <>{parseInt(item.qty, 10)} {item.unit ?? ''}</>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {quotation.currency} {Number(item.unitPrice).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {quotation.currency} {lineTotal.toFixed(2)}
                  </td>
                  {amendMode && (
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          setRemovedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })
                        }}
                        className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                          isRemoved
                            ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            : 'bg-red-100 text-red-600 hover:bg-red-200'
                        }`}
                      >
                        {isRemoved ? 'Undo' : 'Remove'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={amendMode ? 3 : 3} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total</td>
              <td className="px-4 py-3 text-right text-lg font-bold text-gray-900">
                {quotation.currency} {(amendMode ? amendPreviewTotal : (quotation.totalAmount ? Number(quotation.totalAmount) : 0)).toFixed(2)}
              </td>
              {amendMode && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* PDF Download */}
      <div className="flex justify-end">
        <a
          href={`/api/portal/quotations/${quotation.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          📄 Download PDF
        </a>
      </div>

      {/* Terms */}
      {quotation.termsConditions && (
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Terms &amp; Conditions</p>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{quotation.termsConditions}</p>
        </div>
      )}

      {/* Amend mode actions */}
      {amendMode && (
        <div className="bg-white border border-blue-200 rounded-2xl p-6 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={submitAmendment}
              disabled={submitting}
              className="flex-1 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Amendment'}
            </button>
            <button
              onClick={cancelAmend}
              disabled={submitting}
              className="flex-1 py-3 bg-white text-gray-600 border border-gray-300 text-sm font-bold rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Accept / Decline + Amend */}
      {quotation.status === 'sent' && !amendMode && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-6 space-y-3">
          <p className="text-sm font-semibold text-purple-900">Your quotation is ready — please respond:</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => respond('accept')} disabled={responding}
              className="flex-1 py-3 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
              {responding ? '…' : '✓ Accept Quotation'}
            </button>
            <button onClick={() => respond('decline')} disabled={responding}
              className="flex-1 py-3 bg-white text-red-600 border border-red-300 text-sm font-bold rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors">
              {responding ? '…' : '✕ Decline'}
            </button>
          </div>
          {canAmend && (
            <div className="pt-2 border-t border-purple-100">
              <button
                onClick={enterAmendMode}
                className="w-full py-2.5 bg-white text-blue-600 border border-blue-200 text-sm font-semibold rounded-xl hover:bg-blue-50 transition-colors"
              >
                ✏️ Request Qty Amendment
              </button>
              <p className="text-xs text-gray-400 text-center mt-1.5">One amendment allowed per quotation</p>
            </div>
          )}
        </div>
      )}

      {quotation.status === 'accepted' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-sm text-green-800 font-medium">
          ✓ You have accepted this quotation. Your Flexxo sales representative will be in touch to confirm the order.
        </div>
      )}
      {quotation.status === 'declined' && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-sm text-gray-600">
          You declined this quotation. Contact your Flexxo representative if you&apos;d like to discuss further.
        </div>
      )}
      {quotation.status === 'pending_review' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 text-sm text-yellow-800">
          ⏳ Your quote request is being reviewed by your Flexxo sales representative. We&apos;ll notify you when it&apos;s ready.
        </div>
      )}
    </div>
  )
}
