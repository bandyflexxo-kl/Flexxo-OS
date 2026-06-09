'use client'

/**
 * /admin/account-requests
 * Review incoming B2B shop account requests.
 *
 * Status flow: pending → contacted → converted / rejected
 *
 * Admin / Manager only (enforced on API routes — page shows gracefully if
 * user somehow lands here with wrong role).
 */

import { useEffect, useState, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'

// ── Types ─────────────────────────────────────────────────────────────────────

type AccountRequest = {
  id:          string
  fullName:    string
  companyName: string
  email:       string
  phone:       string | null
  message:     string | null
  status:      'pending' | 'contacted' | 'converted' | 'rejected'
  notes:       string | null
  createdAt:   string
  updatedAt:   string
}

type Status = 'pending' | 'contacted' | 'converted' | 'rejected'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_TABS: { value: Status | 'all'; label: string; color: string }[] = [
  { value: 'all',       label: 'All',       color: 'gray'   },
  { value: 'pending',   label: 'Pending',   color: 'amber'  },
  { value: 'contacted', label: 'Contacted', color: 'blue'   },
  { value: 'converted', label: 'Converted', color: 'green'  },
  { value: 'rejected',  label: 'Rejected',  color: 'red'    },
]

const STATUS_BADGE: Record<Status, string> = {
  pending:   'bg-amber-100 text-amber-800',
  contacted: 'bg-blue-100 text-blue-800',
  converted: 'bg-green-100 text-green-800',
  rejected:  'bg-red-100 text-red-800',
}

// ── Request card ──────────────────────────────────────────────────────────────

function RequestCard({
  req,
  onUpdate,
}: {
  req:      AccountRequest
  onUpdate: (id: string, patch: { status?: Status; notes?: string }) => Promise<void>
}) {
  const [busy,          setBusy]          = useState(false)
  const [showReject,    setShowReject]     = useState(false)
  const [rejectNote,    setRejectNote]     = useState('')
  const [showNoteEdit,  setShowNoteEdit]   = useState(false)
  const [noteValue,     setNoteValue]      = useState(req.notes ?? '')

  async function act(patch: { status?: Status; notes?: string }) {
    setBusy(true)
    try { await onUpdate(req.id, patch) }
    finally { setBusy(false) }
  }

  // Pre-fill query params for the Customer Accounts creation form
  const createAccountUrl = `/admin/customer-accounts?prefill=${encodeURIComponent(
    JSON.stringify({ name: req.fullName, email: req.email, companyName: req.companyName }),
  )}`

  return (
    <div className={`bg-white rounded-xl border transition-opacity ${req.status === 'rejected' ? 'opacity-60 border-gray-200' : 'border-gray-200'}`}>
      {/* Header row */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{req.fullName}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[req.status]}`}>
              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
            </span>
          </div>
          <p className="text-xs font-medium text-green-700 mt-0.5">{req.companyName}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <a href={`mailto:${req.email}`} className="text-xs text-blue-600 hover:underline">{req.email}</a>
            {req.phone && <span className="text-xs text-gray-500">{req.phone}</span>}
          </div>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{timeAgo(req.createdAt)}</span>
      </div>

      {/* Message */}
      {req.message && (
        <div className="px-5 pb-3">
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 italic">
            &ldquo;{req.message}&rdquo;
          </p>
        </div>
      )}

      {/* Internal notes */}
      {(req.notes || showNoteEdit) && (
        <div className="px-5 pb-3">
          {showNoteEdit ? (
            <div className="flex gap-2 items-start">
              <textarea
                value={noteValue}
                onChange={e => setNoteValue(e.target.value)}
                rows={2}
                placeholder="Internal notes…"
                className="flex-1 text-xs border border-gray-300 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 resize-none"
              />
              <div className="flex flex-col gap-1">
                <button
                  onClick={async () => { await act({ notes: noteValue }); setShowNoteEdit(false) }}
                  disabled={busy}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setNoteValue(req.notes ?? ''); setShowNoteEdit(false) }}
                  className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="flex items-start gap-1 cursor-pointer group"
              onClick={() => setShowNoteEdit(true)}
            >
              <span className="text-xs">📝</span>
              <p className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">{req.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Reject confirm section */}
      {showReject && (
        <div className="px-5 pb-3">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-red-800">Reject this request?</p>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={2}
              placeholder="Optional reason / note (visible to admin only)"
              className="w-full text-xs border border-red-200 rounded-lg px-2 py-1.5 outline-none focus:border-red-400 bg-white resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await act({ status: 'rejected', notes: rejectNote || undefined })
                  setShowReject(false)
                }}
                disabled={busy}
                className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
              >
                {busy ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => { setShowReject(false); setRejectNote('') }}
                className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-5 pb-4 flex items-center gap-2 flex-wrap border-t border-gray-50 pt-3">
        {req.status === 'pending' && (
          <>
            <button
              onClick={() => act({ status: 'contacted' })}
              disabled={busy}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {busy ? '…' : '✓ Mark Contacted'}
            </button>
            <a
              href={createAccountUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              Create Account →
            </a>
            <button
              onClick={() => setShowReject(true)}
              disabled={busy}
              className="text-xs px-3 py-1.5 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              ✕ Reject
            </button>
          </>
        )}

        {req.status === 'contacted' && (
          <>
            <a
              href={createAccountUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              Create Account →
            </a>
            <button
              onClick={() => act({ status: 'converted' })}
              disabled={busy}
              className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50"
            >
              {busy ? '…' : '✓ Mark Converted'}
            </button>
            <button
              onClick={() => setShowReject(true)}
              disabled={busy}
              className="text-xs px-3 py-1.5 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              ✕ Reject
            </button>
          </>
        )}

        {req.status === 'converted' && (
          <span className="text-xs text-green-700 font-medium">✓ Account created</span>
        )}

        {req.status === 'rejected' && (
          <button
            onClick={() => act({ status: 'pending' })}
            disabled={busy}
            className="text-xs px-3 py-1.5 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            ↩ Reopen
          </button>
        )}

        {/* Note toggle — always accessible */}
        {!showNoteEdit && req.status !== 'rejected' && (
          <button
            onClick={() => setShowNoteEdit(true)}
            className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
          >
            {req.notes ? '✏ Edit note' : '+ Add note'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountRequestsPage() {
  const [requests, setRequests] = useState<AccountRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<Status | 'all'>('pending')

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/account-requests')
      const data = await res.json() as { requests: AccountRequest[] }
      setRequests(data.requests ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  async function handleUpdate(id: string, patch: { status?: Status; notes?: string }) {
    const res  = await fetch(`/api/admin/account-requests/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    })
    const data = await res.json() as { request: AccountRequest }
    if (res.ok && data.request) {
      setRequests(prev => prev.map(r => r.id === id ? data.request : r))
    }
  }

  const counts = {
    all:       requests.length,
    pending:   requests.filter(r => r.status === 'pending').length,
    contacted: requests.filter(r => r.status === 'contacted').length,
    converted: requests.filter(r => r.status === 'converted').length,
    rejected:  requests.filter(r => r.status === 'rejected').length,
  }

  const filtered = tab === 'all' ? requests : requests.filter(r => r.status === tab)

  return (
    <div>
      <Topbar title="Account Requests" />
      <div className="p-6 max-w-3xl">

        {/* Status tabs */}
        <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
          {STATUS_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                tab === t.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {(counts[t.value] ?? 0) > 0 && (
                <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                  tab === t.value ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-500'
                }`}>
                  {counts[t.value]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-3">
              {tab === 'pending' ? '🎉' : tab === 'rejected' ? '🚫' : '📭'}
            </p>
            <p className="text-sm font-medium">
              {tab === 'pending'
                ? 'No pending requests — all caught up!'
                : tab === 'all'
                ? 'No account requests yet.'
                : `No ${tab} requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(req => (
              <RequestCard key={req.id} req={req} onUpdate={handleUpdate} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
