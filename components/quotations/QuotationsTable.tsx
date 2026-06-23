'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const STATUS_COLORS: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-blue-100 text-blue-700',
  sent:           'bg-purple-100 text-purple-700',
  accepted:       'bg-green-100 text-green-700',
  declined:       'bg-red-100 text-red-700',
  expired:        'bg-gray-100 text-gray-500',
}

export type QuotationRow = {
  id:          string
  referenceNo: string
  status:      string
  totalAmount: string | null
  createdAt:   string
  company:     { id: string; name: string }
  createdBy:   { name: string }
  _count:      { items: number }
}

const PRIVILEGED = ['Admin', 'Director', 'Manager']

export default function QuotationsTable({
  quotations,
  role,
}: {
  quotations: QuotationRow[]
  role:       string
}) {
  const router = useRouter()
  const [selected,       setSelected]      = useState<Set<string>>(new Set())
  const [busy,           setBusy]          = useState<'archive' | 'approve' | 'reject' | null>(null)
  const [,               startTransition]  = useTransition()

  const isPrivileged = PRIVILEGED.includes(role)
  const allIds       = quotations.map(q => q.id)
  const allChecked   = selected.size === allIds.length && allIds.length > 0
  const someChecked  = selected.size > 0 && !allChecked

  // Count how many selected are pending_review (for approve/reject relevance hint)
  const pendingSelected = quotations.filter(q => selected.has(q.id) && q.status === 'pending_review').length

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function refresh() {
    setSelected(new Set())
    startTransition(() => router.refresh())
  }

  async function handleArchive() {
    if (!confirm(`Archive ${selected.size} quotation${selected.size > 1 ? 's' : ''}? They will be hidden from this list.`)) return
    setBusy('archive')
    try {
      const res = await fetch('/api/quotations/archive', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: [...selected] }),
      })
      if (!res.ok) throw new Error()
      refresh()
    } catch {
      alert('Archive failed — please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleApprove() {
    if (pendingSelected === 0) {
      alert('None of the selected quotations are in "pending review" status.')
      return
    }
    if (!confirm(`Approve and send ${pendingSelected} quotation${pendingSelected > 1 ? 's' : ''}? Emails will be sent to clients immediately.`)) return
    setBusy('approve')
    try {
      const res = await fetch('/api/quotations/bulk-approve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: [...selected] }),
      })
      const data = await res.json() as { approved?: number; skipped?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      refresh()
      if ((data.skipped ?? 0) > 0)
        alert(`${data.approved} approved. ${data.skipped} skipped (not pending review).`)
    } catch (err) {
      alert(`Approve failed — ${err instanceof Error ? err.message : 'please try again.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleReject() {
    if (pendingSelected === 0) {
      alert('None of the selected quotations are in "pending review" status.')
      return
    }
    const reason = prompt(`Rejection reason for ${pendingSelected} quotation${pendingSelected > 1 ? 's' : ''} (required):`)
    if (!reason?.trim()) return
    setBusy('reject')
    try {
      const res = await fetch('/api/quotations/bulk-reject', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: [...selected], reason: reason.trim() }),
      })
      const data = await res.json() as { rejected?: number; skipped?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      refresh()
      if ((data.skipped ?? 0) > 0)
        alert(`${data.rejected} rejected. ${data.skipped} skipped (not pending review).`)
    } catch (err) {
      alert(`Reject failed — ${err instanceof Error ? err.message : 'please try again.'}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm">
          <span className="font-medium text-blue-700">{selected.size} selected</span>
          {pendingSelected > 0 && (
            <span className="text-xs text-blue-400">({pendingSelected} pending review)</span>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-blue-400 hover:text-blue-600 underline"
          >
            Clear
          </button>

          <div className="ml-auto flex items-center gap-2">
            {isPrivileged && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {busy === 'approve' ? '…' : '✓'} Approve &amp; Send
                </button>
                <button
                  onClick={handleReject}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {busy === 'reject' ? '…' : '✕'} Reject
                </button>
              </>
            )}
            <button
              onClick={handleArchive}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {busy === 'archive' ? '…' : '🗄'} Archive
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked }}
                  onChange={toggleAll}
                  className="rounded cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Created By</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {quotations.map(q => (
              <tr
                key={q.id}
                className={`border-b border-gray-50 transition-colors ${selected.has(q.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggleOne(q.id)}
                    className="rounded cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{q.referenceNo}</td>
                <td className="px-4 py-3">
                  <Link href={`/companies/${q.company.id}`} className="text-gray-700 hover:text-blue-600 transition-colors">
                    {q.company.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {q.status.replace(/_/g, ' ')}
                  </span>
                  {q.status === 'pending_review' && (
                    <span className="ml-1.5 text-xs text-yellow-600 font-medium animate-pulse">Action needed</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{q._count.items}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">
                  {q.totalAmount ? `MYR ${Number(q.totalAmount).toFixed(2)}` : '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{q.createdBy.name}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(q.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/quotations/${q.id}`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
