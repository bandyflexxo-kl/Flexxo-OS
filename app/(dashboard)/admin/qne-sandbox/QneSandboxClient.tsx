'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'

type QnePendingItem = {
  id:           string
  actionType:   string
  referenceNo:  string
  originalDate: string
  payload:      Record<string, unknown>
  status:       string
  notes:        string | null
  approvedAt:   string | null
  approvedBy:   { name: string } | null
  createdAt:    string
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  invoice:      '🧾 Invoice',
  delivery_order: '📦 Delivery Order',
  quotation:    '📋 Quotation',
  sales_order:  '🛒 Sales Order',
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

type DocTypeFilter = 'all' | 'invoice' | 'quotation' | 'sales_order' | 'delivery_order'
type StatusFilter  = 'pending' | 'approved' | 'rejected' | 'all'

const DOC_TYPE_LABELS: Record<DocTypeFilter, string> = {
  all:            'All Types',
  invoice:        '🧾 Invoices',
  quotation:      '📋 Quotations',
  sales_order:    '🛒 Sales Orders',
  delivery_order: '📦 Delivery Orders',
}

export default function QneSandboxClient() {
  const [items,       setItems]       = useState<QnePendingItem[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState<StatusFilter>('pending')
  const [docType,     setDocType]     = useState<DocTypeFilter>('all')
  const [acting,      setActing]      = useState<string | null>(null)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [notes,       setNotes]       = useState<Record<string, string>>({})
  const [error,       setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/qne-sandbox?status=${filter}&type=${docType}`)
      const data = await res.json() as { items?: QnePendingItem[]; error?: string }
      if (!res.ok) { setError(data.error ?? 'Load failed'); return }
      setItems(data.items ?? [])
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [filter, docType])

  useEffect(() => { void load() }, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/qne-sandbox/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, notes: notes[id] ?? undefined }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Action failed'); return }
      // Optimistically remove from current filtered list
      setItems(prev => prev.filter(i => i.id !== id))
    } finally {
      setActing(null)
    }
  }

  const pendingCount = items.filter(i => i.status === 'pending').length

  return (
    <div className="space-y-6 pb-16">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">QNE Sandbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            Staged records waiting for manual entry into QNE Optimum.
            Review monthly — approve items that are ready, then enter them in QNE using the <strong>original date</strong>.
          </p>
        </div>
        {filter === 'pending' && pendingCount > 0 && (
          <span className="inline-flex items-center px-3 py-1.5 bg-amber-100 text-amber-800 text-sm font-semibold rounded-full">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* ── Info banner ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">📋 How this works</p>
        <ul className="list-disc list-inside space-y-0.5 text-blue-700">
          <li>Every invoice created in this CMS is automatically staged here.</li>
          <li>At month-end, review each item and click <strong>Approve</strong> for ones to enter in QNE.</li>
          <li>Open QNE Optimum and enter the record manually — <strong>use the Original Date</strong>, not today&apos;s date.</li>
          <li>Reject items that were cancelled or not yet ready.</li>
        </ul>
      </div>

      {/* ── Status filter tabs ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg capitalize transition-colors ${
              filter === f
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ── Doc type filter tabs ── */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(DOC_TYPE_LABELS) as [DocTypeFilter, string][]).map(([type, label]) => (
          <button
            key={type}
            onClick={() => setDocType(type)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              docType === type
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">✅</p>
          <p className="font-medium text-gray-600">No {filter !== 'all' ? filter : ''} records</p>
          {filter === 'pending' && <p className="text-sm mt-1">All staged items have been reviewed.</p>}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Original Date</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {filter !== 'all' && filter === 'pending' && (
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <Fragment key={item.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium">
                      {ACTION_TYPE_LABELS[item.actionType] ?? item.actionType}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">{item.referenceNo}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="font-semibold text-red-700">
                        {new Date(item.originalDate).toLocaleDateString('en-MY', {
                          day:   'numeric',
                          month: 'short',
                          year:  'numeric',
                        })}
                      </span>
                      <p className="text-xs text-gray-400">Use this date in QNE</p>
                    </td>
                    <td className="px-4 py-3">
                      {typeof item.payload.companyName === 'string' && (
                        <p className="text-gray-700">{item.payload.companyName}</p>
                      )}
                      {item.payload.totalAmount !== undefined && (
                        <p className="text-xs text-gray-500">
                          {typeof item.payload.currency === 'string' ? item.payload.currency : 'MYR'}{' '}
                          {Number(item.payload.totalAmount).toFixed(2)}
                        </p>
                      )}
                      <button
                        onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                        className="text-xs text-blue-500 hover:underline mt-0.5"
                      >
                        {expanded === item.id ? '▲ Hide' : '▼ Show'} payload
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {item.status}
                      </span>
                      {item.approvedBy && (
                        <p className="text-xs text-gray-400 mt-0.5">by {item.approvedBy.name}</p>
                      )}
                    </td>
                    {item.status === 'pending' && (
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={notes[item.id] ?? ''}
                            onChange={e => setNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => act(item.id, 'approve')}
                              disabled={acting === item.id}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                            >
                              {acting === item.id ? '…' : '✓ Approve'}
                            </button>
                            <button
                              onClick={() => act(item.id, 'reject')}
                              disabled={acting === item.id}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                            >
                              {acting === item.id ? '…' : '✕ Reject'}
                            </button>
                          </div>
                        </div>
                      </td>
                    )}
                    {item.status !== 'pending' && filter === 'pending' && (
                      <td className="px-4 py-3" />
                    )}
                  </tr>
                  {expanded === item.id && (
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-48 bg-white rounded-lg p-3 border border-gray-200">
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                        {item.notes && (
                          <p className="text-xs text-gray-500 mt-2"><span className="font-medium">Notes:</span> {item.notes}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
