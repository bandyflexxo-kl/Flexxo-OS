'use client'

import { useState, useMemo } from 'react'
import Modal from '@/components/ui/Modal'

type StagingRow = {
  id:              string
  rawRowNumber:    number | null
  rawItemName:     string | null
  rawBrand:        string | null
  rawUnit:         string | null
  rawPrice:        string | null
  parsedPrice:     number | null
  parsedCurrency:  string | null
  parsedMoq:       number | null
  parsedValidUntil: string | null
  stagingStatus:   string
}

type Category = {
  id:   string
  name: string
  parentCategory?: { name: string } | null
}

type Stats = {
  pending:  number
  approved: number
  rejected: number
}

const PAGE_SIZE = 50

export default function PriceFileStagingTable({
  rows:        initialRows,
  categories,
  stats:       initialStats,
  supplierId,
}: {
  rows:        StagingRow[]
  categories:  Category[]
  stats:       Stats
  supplierId:  string
}) {
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())
  const [busy,        setBusy]        = useState<Set<string>>(new Set())
  const [stats,       setStats]       = useState(initialStats)
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [error,       setError]       = useState<string | null>(null)
  const [bulkBusy,    setBulkBusy]    = useState(false)
  const [selected,    setSelected]    = useState<Set<string>>(new Set())

  // Approve modal
  const [approveRow, setApproveRow] = useState<StagingRow | null>(null)
  const [approveForm, setApproveForm] = useState({
    productName: '',
    categoryId:  '',
    brand:       '',
    unit:        '',
    price:       '',
    moq:         '',
    validUntil:  '',
  })
  const [approveError, setApproveError] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialRows.filter(r => {
      if (dismissed.has(r.id)) return false
      if (r.stagingStatus !== 'pending_review') return false
      if (!q) return true
      return (r.rawItemName ?? '').toLowerCase().includes(q) ||
             (r.rawBrand   ?? '').toLowerCase().includes(q)
    })
  }, [initialRows, dismissed, search])

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
  }

  function openApproveModal(row: StagingRow) {
    setApproveRow(row)
    setApproveForm({
      productName: row.rawItemName ?? '',
      categoryId:  categories[0]?.id ?? '',
      brand:       row.rawBrand    ?? '',
      unit:        row.rawUnit     ?? '',
      price:       row.parsedPrice != null ? String(row.parsedPrice) : row.rawPrice ?? '',
      moq:         row.parsedMoq   != null ? String(row.parsedMoq) : '',
      validUntil:  row.parsedValidUntil
        ? new Date(row.parsedValidUntil).toISOString().slice(0, 10)
        : '',
    })
    setApproveError(null)
  }

  async function submitApprove() {
    if (!approveRow) return
    const price = parseFloat(approveForm.price)
    if (!approveForm.productName.trim()) { setApproveError('Product name is required.'); return }
    if (!approveForm.categoryId)          { setApproveError('Category is required.'); return }
    if (isNaN(price) || price <= 0)       { setApproveError('Price must be a positive number.'); return }

    setBusy(b => new Set([...b, approveRow.id]))
    setApproveError(null)
    try {
      const res = await fetch(`/api/supplier-price-staging/${approveRow.id}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          productName: approveForm.productName.trim(),
          categoryId:  approveForm.categoryId,
          brand:       approveForm.brand.trim() || undefined,
          unit:        approveForm.unit.trim()  || undefined,
          price,
          moq:         approveForm.moq ? parseInt(approveForm.moq, 10) : undefined,
          validUntil:  approveForm.validUntil || undefined,
        }),
      })
      const data = await res.json() as { error?: unknown }
      if (!res.ok) {
        const msg = typeof data.error === 'string' ? data.error : 'Approve failed.'
        setApproveError(msg)
        return
      }
      dismiss(approveRow.id, { approved: 1 })
      setApproveRow(null)
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(approveRow.id); return n })
    }
  }

  async function rejectOne(id: string) {
    setBusy(b => new Set([...b, id]))
    setError(null)
    try {
      const res = await fetch(`/api/supplier-price-staging/${id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{}',
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Reject failed'); return }
      dismiss(id, { rejected: 1 })
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(id); return n })
    }
  }

  async function rejectSelected() {
    const ids = [...selected]
    if (!ids.length) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all(ids.map(id => rejectOne(id)))
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6 text-sm">
          <span className="font-semibold text-gray-900">{stats.pending} pending</span>
          <span className="text-green-600">{stats.approved} approved</span>
          <span className="text-red-500">{stats.rejected} rejected</span>
        </div>
        {selected.size > 0 && (
          <button
            onClick={rejectSelected}
            disabled={bulkBusy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {bulkBusy ? 'Rejecting…' : `Reject selected (${selected.size})`}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by item name or brand…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-72"
        />
        {search && (
          <button onClick={() => { setSearch(''); setPage(1) }} className="text-xs text-gray-400 hover:text-gray-600">
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400">{visible.length} rows</span>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
          {search ? 'No rows match your search.' : 'All rows have been reviewed.'}
        </div>
      ) : (
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
                  <th className="px-4 py-3 font-medium">Row</th>
                  <th className="px-4 py-3 font-medium">Item Name</th>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">MOQ</th>
                  <th className="px-4 py-3 font-medium">Valid Until</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => {
                  const isBusy     = busy.has(row.id)
                  const isSelected = selected.has(row.id)
                  const hasPrice   = row.parsedPrice != null && row.parsedPrice > 0
                  return (
                    <tr
                      key={row.id}
                      className={`border-b transition-colors ${
                        !hasPrice
                          ? 'bg-amber-50 border-amber-100'
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
                      <td className="px-4 py-3 text-gray-400 text-xs">{row.rawRowNumber ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[220px] truncate">
                        {row.rawItemName ?? <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.rawBrand ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.rawUnit ?? '—'}</td>
                      <td className="px-4 py-3">
                        {hasPrice ? (
                          <span className="text-gray-900 font-medium text-xs">
                            {row.parsedCurrency ?? 'MYR'} {Number(row.parsedPrice).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-amber-600 text-xs">
                            ⚠ {row.rawPrice || 'No price'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.parsedMoq ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {row.parsedValidUntil
                          ? new Date(row.parsedValidUntil).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openApproveModal(row)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectOne(row.id)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            {isBusy ? '…' : 'Reject'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="px-3 py-1.5">{safePage} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Approve Modal */}
      {approveRow && (
        <Modal
          title="Approve Price Item"
          onClose={() => setApproveRow(null)}
          actions={
            <>
              <button
                onClick={() => setApproveRow(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitApprove}
                disabled={busy.has(approveRow.id)}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {busy.has(approveRow.id) ? 'Saving…' : 'Approve & Save'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Product Name *</label>
              <input
                type="text"
                value={approveForm.productName}
                onChange={e => setApproveForm(f => ({ ...f, productName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={approveForm.categoryId}
                onChange={e => setApproveForm(f => ({ ...f, categoryId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="">— Select category —</option>
                {/* Top-level categories first, then subcategories grouped by parent */}
                {categories.filter(c => !c.parentCategory).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {Array.from(
                  categories.filter(c => c.parentCategory).reduce((m, c) => {
                    const key  = c.parentCategory!.name
                    const list = m.get(key) ?? []
                    list.push(c)
                    m.set(key, list)
                    return m
                  }, new Map<string, Category[]>())
                ).sort((a, b) => a[0].localeCompare(b[0])).map(([parentName, subs]) => (
                  <optgroup key={parentName} label={parentName}>
                    {subs.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Brand</label>
                <input
                  type="text"
                  value={approveForm.brand}
                  onChange={e => setApproveForm(f => ({ ...f, brand: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                <input
                  type="text"
                  value={approveForm.unit}
                  onChange={e => setApproveForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. pcs, box, ream"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Cost Price (MYR) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={approveForm.price}
                  onChange={e => setApproveForm(f => ({ ...f, price: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Min Order Qty</label>
                <input
                  type="number"
                  min="1"
                  value={approveForm.moq}
                  onChange={e => setApproveForm(f => ({ ...f, moq: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="1"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Valid Until</label>
              <input
                type="date"
                value={approveForm.validUntil}
                onChange={e => setApproveForm(f => ({ ...f, validUntil: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            {approveError && <p className="text-xs text-red-600">{approveError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
