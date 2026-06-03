'use client'

import { useState, useMemo, useCallback } from 'react'
import Modal from '@/components/ui/Modal'

const PAGE_SIZE = 50

type ProductRow = {
  id:                   string
  name:                 string
  brand:                string | null
  unit:                 string | null
  internalSku:          string | null
  qneItemCode:          string | null
  category:             { id: string; name: string }
  catalogDescription:   string | null
  defaultMarginPct:     string | null
  googleDrivePhotoId:   string | null
  isVisibleToCustomers: boolean
  costPrice:            string | null
  sellingPrice:         string | null
  currency:             string
}

export default function ProductCatalogTable({
  products:      initialProducts,
  globalMargin,
}: {
  products:     ProductRow[]
  globalMargin: string
}) {
  const [products,       setProducts]       = useState(initialProducts)
  const [error,          setError]          = useState<string | null>(null)
  const [success,        setSuccess]        = useState<string | null>(null)
  const [scanning,       setScanning]       = useState(false)
  const [scanResult,     setScanResult]     = useState<{ matched: number; total: number } | null>(null)
  const [search,         setSearch]         = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [bulkBusy,       setBulkBusy]       = useState(false)
  const [page,           setPage]           = useState(0)

  // Per-row busy: only block the specific row's actions, not the whole table
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  // Edit modal
  const [editRow,  setEditRow]  = useState<ProductRow | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editMarg, setEditMarg] = useState('')
  const [editErr,  setEditErr]  = useState<string | null>(null)

  // Unique categories
  const allCategories = useMemo(() =>
    Array.from(new Map(initialProducts.map(p => [p.category.id, p.category])).values())
      .sort((a, b) => a.name.localeCompare(b.name)),
    [initialProducts]
  )

  // Filtered list (all matching rows — used for counts + pagination)
  const filtered = useMemo(() => {
    const q    = search.toLowerCase()
    return products.filter(p => {
      const matchSearch   = !q || p.name.toLowerCase().includes(q) || (p.qneItemCode ?? '').toLowerCase().includes(q)
      const matchCategory = !categoryFilter || p.category.id === categoryFilter
      return matchSearch && matchCategory
    })
  }, [products, search, categoryFilter])

  // Page slice — only these rows get rendered into the DOM
  const pageRows = useMemo(() =>
    filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  )

  const totalPages    = Math.ceil(filtered.length / PAGE_SIZE)
  const visibleCount  = useMemo(() => products.filter(p => p.isVisibleToCustomers).length, [products])
  const photoCount    = useMemo(() => products.filter(p => p.googleDrivePhotoId).length,    [products])

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3500)
  }

  function resetPage() { setPage(0) }

  // ── Optimistic toggle ────────────────────────────────────────────────────
  const toggleVisible = useCallback(async (product: ProductRow) => {
    const newVal = !product.isVisibleToCustomers

    // 1. Update state immediately (optimistic)
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, isVisibleToCustomers: newVal } : p))
    setBusyIds(prev => new Set([...prev, product.id]))
    setError(null)

    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ isVisibleToCustomers: newVal }),
      })
      if (!res.ok) {
        // Rollback on failure
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, isVisibleToCustomers: !newVal } : p))
        setError('Failed to update visibility. Please try again.')
      }
    } catch {
      // Rollback on network error
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, isVisibleToCustomers: !newVal } : p))
      setError('Network error. Please try again.')
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(product.id); return n })
    }
  }, [])

  // ── Find photo ───────────────────────────────────────────────────────────
  async function findPhoto(product: ProductRow) {
    setBusyIds(prev => new Set([...prev, product.id]))
    setError(null)
    try {
      const res  = await fetch(`/api/admin/products/${product.id}/find-photo`, { method: 'POST' })
      const data = await res.json() as { found?: boolean; fileId?: string; message?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      if (data.found && data.fileId) {
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, googleDrivePhotoId: data.fileId ?? null } : p))
        flash(`Photo found for ${product.name}`)
      } else {
        setError(data.message ?? 'No photo found')
      }
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(product.id); return n })
    }
  }

  // ── Scan all photos ──────────────────────────────────────────────────────
  async function scanAllPhotos() {
    setScanning(true)
    setScanResult(null)
    setError(null)
    try {
      const res  = await fetch('/api/admin/products/scan-photos', { method: 'POST' })
      const data = await res.json() as { matched?: number; total?: number; error?: string }
      if (!res.ok) { setError(data.error ?? 'Scan failed'); return }
      setScanResult({ matched: data.matched ?? 0, total: data.total ?? 0 })
      const listRes = await fetch('/api/admin/products')
      const newList = await listRes.json() as ProductRow[]
      setProducts(newList)
    } finally {
      setScanning(false)
    }
  }

  // ── Bulk visibility ──────────────────────────────────────────────────────
  async function bulkSetVisible(makeVisible: boolean) {
    const catName    = allCategories.find(c => c.id === categoryFilter)?.name
    const scopeLabel = categoryFilter
      ? `all products in "${catName ?? 'this category'}"`
      : `all ${products.length.toLocaleString()} products`
    const action = makeVisible ? 'visible to customers' : 'hidden from customers'
    if (!confirm(`This will make ${scopeLabel} ${action}. Continue?`)) return

    setBulkBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { visible: makeVisible }
      if (categoryFilter) body.categoryId = categoryFilter

      const res  = await fetch('/api/admin/products/bulk-visibility', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json() as { updated?: number; error?: unknown }
      if (!res.ok) { setError(String(data.error ?? 'Failed')); return }

      setProducts(prev => prev.map(p => {
        if (categoryFilter && p.category.id !== categoryFilter) return p
        return { ...p, isVisibleToCustomers: makeVisible }
      }))
      flash(`${(data.updated ?? 0).toLocaleString()} products ${makeVisible ? 'made visible' : 'hidden'}.`)
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Save edit ────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!editRow) return
    setBusyIds(prev => new Set([...prev, editRow.id]))
    setEditErr(null)
    try {
      const res = await fetch(`/api/admin/products/${editRow.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          catalogDescription: editDesc || null,
          defaultMarginPct:   editMarg || null,
        }),
      })
      if (!res.ok) { setEditErr('Failed to save'); return }
      setProducts(prev => prev.map(p => p.id === editRow.id
        ? { ...p, catalogDescription: editDesc || null, defaultMarginPct: editMarg || null }
        : p
      ))
      flash(`Updated ${editRow.name}`)
      setEditRow(null)
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(editRow.id); return n })
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{success}</div>
      )}
      {scanResult && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Photo scan complete — {scanResult.matched} photos matched out of {scanResult.total} products.
        </div>
      )}

      {/* Toolbar row 1: search + category */}
      <div className="flex items-center flex-wrap gap-3">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); resetPage() }}
          placeholder="Search by name or item code…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-64"
        />
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); resetPage() }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 text-gray-700"
        >
          <option value="">All Categories</option>
          {allCategories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">
          {filtered.length.toLocaleString()} shown · {visibleCount.toLocaleString()} visible · {photoCount} with photos
        </span>
      </div>

      {/* Toolbar row 2: bulk actions */}
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-xs text-gray-500 font-medium mr-1">
          {categoryFilter ? `${allCategories.find(c => c.id === categoryFilter)?.name ?? 'Category'}:` : 'All products:'}
        </span>
        <button
          onClick={() => bulkSetVisible(true)}
          disabled={bulkBusy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {bulkBusy ? '…' : '✓ Mark All Visible'}
        </button>
        <button
          onClick={() => bulkSetVisible(false)}
          disabled={bulkBusy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {bulkBusy ? '…' : '✕ Hide All'}
        </button>
        <div className="flex-1" />
        <button
          onClick={scanAllPhotos}
          disabled={scanning}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {scanning ? '⏳ Scanning…' : '📷 Scan All Photos'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Margin</th>
              <th className="px-4 py-3 font-medium">Selling</th>
              <th className="px-4 py-3 font-medium">Photo</th>
              <th className="px-4 py-3 font-medium">Visible</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No products found.</td></tr>
            ) : pageRows.map(p => {
              const isBusy = busyIds.has(p.id)
              return (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900 text-sm leading-snug">{p.name}</p>
                    {p.brand && <p className="text-xs text-gray-400">{p.brand}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{p.qneItemCode ?? p.internalSku ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{p.category.name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">
                    {p.costPrice ? `${p.currency} ${Number(p.costPrice).toFixed(2)}` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">
                    {p.defaultMarginPct
                      ? `${p.defaultMarginPct}%`
                      : <span className="text-gray-400">{globalMargin}%</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium text-blue-700">
                    {p.sellingPrice ? `${p.currency} ${Number(p.sellingPrice).toFixed(2)}` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {p.googleDrivePhotoId
                      ? <span className="text-green-600">✓</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    {/* Toggle — visual change is instant (optimistic) */}
                    <button
                      onClick={() => toggleVisible(p)}
                      disabled={isBusy}
                      aria-label={p.isVisibleToCustomers ? 'Hide product' : 'Show product'}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40 ${
                        p.isVisibleToCustomers ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                        p.isVisibleToCustomers ? 'translate-x-4' : 'translate-x-1'
                      }`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => { setEditRow(p); setEditDesc(p.catalogDescription ?? ''); setEditMarg(p.defaultMarginPct ?? ''); setEditErr(null) }}
                        disabled={isBusy}
                        className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        Edit
                      </button>
                      {!p.googleDrivePhotoId && p.qneItemCode && (
                        <button
                          onClick={() => findPhoto(p)}
                          disabled={isBusy}
                          className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          {isBusy ? '…' : '📷'}
                        </button>
                      )}
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
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-gray-400">
            Page {page + 1} of {totalPages} · showing {pageRows.length} of {filtered.length.toLocaleString()} products
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >← Prev</button>

            {/* Page number chips — show up to 7 */}
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const startPage = Math.max(0, Math.min(page - 3, totalPages - 7))
              const pg = startPage + i
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    pg === page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {pg + 1}
                </button>
              )
            })}

            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >Next →</button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >»</button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editRow && (
        <Modal
          title={`Edit catalog — ${editRow.name}`}
          onClose={() => setEditRow(null)}
          actions={
            <>
              <button onClick={() => setEditRow(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={saveEdit} disabled={busyIds.has(editRow.id)} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {busyIds.has(editRow.id) ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Catalog Description (shown to customers)</label>
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Describe this product for customers…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Margin % override (leave blank to use global default)</label>
              <input
                type="number"
                value={editMarg}
                onChange={e => setEditMarg(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder={`e.g. 35 (global default: ${globalMargin}%)`}
                min="0"
                step="0.5"
              />
            </div>
            {editErr && <p className="text-xs text-red-600">{editErr}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
