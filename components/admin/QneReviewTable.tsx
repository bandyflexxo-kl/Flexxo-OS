'use client'

import { useState, useMemo } from 'react'

type Row = {
  id:                  string
  qneCustomerCode:     string
  rawName:             string | null
  rawPhone:            string | null
  rawEmail:            string | null
  rawPaymentTerm:      string | null
  rawAddress:          string | null
  rawIndustry:         string | null
  rawSalesPerson:      string | null
  stagedAt:            string
  existingCompanyName: string | null
}

type Stats = {
  pending:  number
  approved: number
  rejected: number
}

type BulkResult = {
  promoted: number
  linked:   number
  skipped:  number
}

const PAGE_SIZE = 50

export default function QneReviewTable({
  rows: initialRows,
  stats: initialStats,
}: {
  rows:  Row[]
  stats: Stats
}) {
  const [dismissed,  setDismissed]  = useState<Set<string>>(new Set())
  const [busy,       setBusy]       = useState<Set<string>>(new Set())
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(1)
  const [stats,      setStats]      = useState(initialStats)
  const [bulkBusy,   setBulkBusy]   = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialRows.filter(r => {
      if (dismissed.has(r.id)) return false
      if (!q) return true
      return (
        r.qneCustomerCode.toLowerCase().includes(q) ||
        (r.rawName  ?? '').toLowerCase().includes(q) ||
        (r.rawEmail ?? '').toLowerCase().includes(q)
      )
    })
  }, [initialRows, dismissed, search])

  const duplicateIds = useMemo(() => {
    const emailMap = new Map<string, string[]>()
    const phoneMap = new Map<string, string[]>()
    for (const row of visible) {
      const email = row.rawEmail?.toLowerCase().trim()
      if (email) {
        if (!emailMap.has(email)) emailMap.set(email, [])
        emailMap.get(email)!.push(row.id)
      }
      const phone = row.rawPhone?.trim()
      if (phone) {
        if (!phoneMap.has(phone)) phoneMap.set(phone, [])
        phoneMap.get(phone)!.push(row.id)
      }
    }
    const dupes = new Set<string>()
    for (const ids of emailMap.values()) if (ids.length > 1) ids.forEach(id => dupes.add(id))
    for (const ids of phoneMap.values()) if (ids.length > 1) ids.forEach(id => dupes.add(id))
    return dupes
  }, [visible])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function dismiss(id: string, delta: { approved?: number; rejected?: number }) {
    setDismissed(prev => new Set([...prev, id]))
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    setStats(s => ({
      pending:  s.pending  - 1,
      approved: s.approved + (delta.approved ?? 0),
      rejected: s.rejected + (delta.rejected ?? 0),
    }))
    setPage(p => Math.min(p, Math.max(1, Math.ceil((visible.length - 1) / PAGE_SIZE))))
  }

  async function promote(id: string) {
    setBusy(b => new Set([...b, id]))
    setError(null)
    try {
      const res  = await fetch(`/api/qne/staging/${id}/promote`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Promote failed'); return }
      dismiss(id, { approved: 1 })
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(id); return n })
    }
  }

  async function reject(id: string) {
    setBusy(b => new Set([...b, id]))
    setError(null)
    try {
      const res  = await fetch(`/api/qne/staging/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Reject failed'); return }
      dismiss(id, { rejected: 1 })
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(id); return n })
    }
  }

  async function promoteAll() {
    setBulkBusy(true)
    setBulkResult(null)
    setError(null)
    try {
      const res  = await fetch('/api/qne/staging/promote-all', { method: 'POST' })
      const data = await res.json() as BulkResult & { error?: string }
      if (!res.ok) { setError(data.error ?? 'Bulk promote failed'); return }
      const ids = initialRows.filter(r => !dismissed.has(r.id)).map(r => r.id)
      setDismissed(prev => new Set([...prev, ...ids]))
      setSelected(new Set())
      const total = data.promoted + data.linked
      setStats(s => ({ pending: 0, approved: s.approved + total, rejected: s.rejected }))
      setBulkResult(data)
    } finally {
      setBulkBusy(false)
    }
  }

  async function rejectSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all(ids.map(id => reject(id)))
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  const cleanCount = visible.filter(r => !r.existingCompanyName).length
  const dupeCount  = visible.filter(r =>  r.existingCompanyName).length

  return (
    <div className="space-y-4">
      {/* Stats + bulk action */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6 text-sm">
          <span className="font-semibold text-gray-900">{stats.pending} pending</span>
          <span className="text-green-600">{stats.approved} approved</span>
          <span className="text-red-500">{stats.rejected} rejected</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={rejectSelected}
              disabled={bulkBusy}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkBusy ? 'Rejecting…' : `Reject selected (${selected.size})`}
            </button>
          )}
          {stats.pending > 0 && (
            <button
              onClick={promoteAll}
              disabled={bulkBusy || cleanCount === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkBusy
                ? 'Approving…'
                : `Approve all new${dupeCount > 0 ? ` (${cleanCount} new + ${dupeCount} link)` : ` (${cleanCount})`}`}
            </button>
          )}
        </div>
      </div>

      {bulkResult && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          Done — {bulkResult.promoted} companies created, {bulkResult.linked} linked to existing.
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Search */}
      {stats.pending > 0 && (
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name, code or email…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-72"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1) }} className="text-xs text-gray-400 hover:text-gray-600">
              Clear
            </button>
          )}
          <span className="text-xs text-gray-400">{visible.length} shown</span>
        </div>
      )}

      {visible.length === 0 && !bulkResult && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
          {search ? 'No records match your search.' : 'All records have been reviewed.'}
        </div>
      )}

      {visible.length > 0 && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={pageRows.length > 0 && pageRows.every(r => selected.has(r.id))}
                      onChange={e => {
                        setSelected(prev => {
                          const n = new Set(prev)
                          pageRows.forEach(r => e.target.checked ? n.add(r.id) : n.delete(r.id))
                          return n
                        })
                      }}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">QNE Code</th>
                  <th className="px-4 py-3 font-medium">Company Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Term</th>
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Salesperson</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => {
                  const isBusy  = busy.has(row.id)
                  const isDupe  = duplicateIds.has(row.id)
                  const isSelected = selected.has(row.id)
                  const rowNum  = (safePage - 1) * PAGE_SIZE + i + 1
                  return (
                    <tr
                      key={row.id}
                      className={`border-b transition-colors ${
                        isDupe
                          ? 'bg-orange-50 border-l-2 border-l-orange-400 border-b-orange-100'
                          : isBusy
                            ? 'opacity-50 border-gray-50'
                            : 'border-gray-50 hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={isSelected}
                          disabled={isBusy}
                          onChange={e => {
                            setSelected(prev => {
                              const n = new Set(prev)
                              e.target.checked ? n.add(row.id) : n.delete(row.id)
                              return n
                            })
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{rowNum}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.qneCustomerCode}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate">
                        {row.rawName ?? <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.rawPhone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px] truncate">
                        {row.rawEmail ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{row.rawPaymentTerm ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.rawIndustry ?? '—'}</td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-700 whitespace-nowrap">
                        {row.rawSalesPerson ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex flex-col gap-1">
                          {isDupe && (
                            <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 border border-orange-300 px-2 py-0.5 rounded-full text-xs font-medium">
                              ⚠ possible duplicate
                            </span>
                          )}
                          {row.existingCompanyName ? (
                            <span className="inline-flex items-center gap-1 bg-yellow-50 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full text-xs">
                              ⚠ links to &quot;{row.existingCompanyName}&quot;
                            </span>
                          ) : (
                            !isDupe && <span className="text-gray-300">new</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => promote(row.id)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {row.existingCompanyName ? 'Link' : 'Approve'}
                          </button>
                          <button
                            onClick={() => reject(row.id)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-3 py-1.5">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
