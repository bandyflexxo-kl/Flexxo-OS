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
  category:             { id: string; name: string; parentName?: string | null }
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
  const [previewing,     setPreviewing]     = useState(false)
  const [scanResult,     setScanResult]     = useState<{
    dryRun:          boolean
    matched:         number
    alreadySet:      number
    notFound:        number
    total:           number
    driveFiles:      number
    byTier:           Record<string, number>
    unmatchedCodes:   string[]
    matchedProducts:  { code: string; name: string; fileId: string; how: string }[]
    sampleDriveFiles: string[]
  } | null>(null)
  const [search,         setSearch]         = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [bulkBusy,       setBulkBusy]       = useState(false)
  const [page,           setPage]           = useState(0)

  // Per-row busy: only block the specific row's actions, not the whole table
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  // Edit modal
  const [editRow,      setEditRow]      = useState<ProductRow | null>(null)
  const [editDesc,     setEditDesc]     = useState('')
  const [editMarg,     setEditMarg]     = useState('')
  const [editPhotoId,  setEditPhotoId]  = useState('')
  const [editErr,      setEditErr]      = useState<string | null>(null)

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

  // ── Preview match (dry run — no DB writes) ──────────────────────────────
  async function previewMatch() {
    setPreviewing(true)
    setScanResult(null)
    setError(null)
    try {
      const res  = await fetch('/api/admin/products/scan-photos?dryRun=true', { method: 'POST' })
      const data = await res.json() as {
        dryRun?: boolean; matched?: number; alreadySet?: number; notFound?: number; total?: number
        driveFiles?: number; byTier?: Record<string, number>; unmatchedCodes?: string[]
        matchedProducts?: { code: string; name: string; fileId: string; how: string }[]
        sampleDriveFiles?: string[]
        error?: string
      }
      if (!res.ok) { setError(data.error ?? 'Preview failed'); return }
      setScanResult({
        dryRun:           true,
        matched:          data.matched          ?? 0,
        alreadySet:       data.alreadySet       ?? 0,
        notFound:         data.notFound         ?? 0,
        total:            data.total            ?? 0,
        driveFiles:       data.driveFiles       ?? 0,
        byTier:           data.byTier           ?? {},
        unmatchedCodes:   data.unmatchedCodes   ?? [],
        matchedProducts:  data.matchedProducts  ?? [],
        sampleDriveFiles: data.sampleDriveFiles ?? [],
      })
    } finally {
      setPreviewing(false)
    }
  }

  // ── Scan all photos ──────────────────────────────────────────────────────
  async function scanAllPhotos() {
    setScanning(true)
    setScanResult(null)
    setError(null)
    try {
      const res  = await fetch('/api/admin/products/scan-photos', { method: 'POST' })
      const data = await res.json() as {
        dryRun?: boolean; matched?: number; alreadySet?: number; notFound?: number; total?: number
        driveFiles?: number; byTier?: Record<string, number>; unmatchedCodes?: string[]
        matchedProducts?: { code: string; name: string; fileId: string; how: string }[]
        sampleDriveFiles?: string[]
        error?: string
      }
      if (!res.ok) { setError(data.error ?? 'Scan failed'); return }
      setScanResult({
        dryRun:           false,
        matched:          data.matched          ?? 0,
        alreadySet:       data.alreadySet       ?? 0,
        notFound:         data.notFound         ?? 0,
        total:            data.total            ?? 0,
        driveFiles:       data.driveFiles       ?? 0,
        byTier:           data.byTier           ?? {},
        unmatchedCodes:   data.unmatchedCodes   ?? [],
        matchedProducts:  data.matchedProducts  ?? [],
        sampleDriveFiles: data.sampleDriveFiles ?? [],
      })
      // Refresh product list to reflect new photo IDs
      const listRes = await fetch('/api/admin/products')
      const newList = await listRes.json() as ProductRow[]
      setProducts(newList)
    } finally {
      setScanning(false)
    }
  }

  // ── Bulk visibility ──────────────────────────────────────────────────────
  async function bulkSetVisible(makeVisible: boolean, hasPhoto = false) {
    const catName    = allCategories.find(c => c.id === categoryFilter)?.name
    const scopeLabel = hasPhoto
      ? `all ${photoCount} products with photos`
      : categoryFilter
        ? `all products in "${catName ?? 'this category'}"`
        : `all ${products.length.toLocaleString()} products`
    const action = makeVisible ? 'visible to customers' : 'hidden from customers'
    if (!confirm(`This will make ${scopeLabel} ${action}. Continue?`)) return

    setBulkBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { visible: makeVisible }
      if (categoryFilter) body.categoryId = categoryFilter
      if (hasPhoto)       body.hasPhoto   = true

      const res  = await fetch('/api/admin/products/bulk-visibility', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json() as { updated?: number; error?: unknown }
      if (!res.ok) { setError(String(data.error ?? 'Failed')); return }

      setProducts(prev => prev.map(p => {
        if (categoryFilter && p.category.id !== categoryFilter) return p
        if (hasPhoto && !p.googleDrivePhotoId) return p
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
      // Only send googleDrivePhotoId if it changed
      const photoChanged = editPhotoId.trim() !== (editRow.googleDrivePhotoId ?? '')
      const body: Record<string, unknown> = {
        catalogDescription: editDesc || null,
        defaultMarginPct:   editMarg || null,
      }
      if (photoChanged) body.googleDrivePhotoId = editPhotoId.trim() || null

      const res = await fetch(`/api/admin/products/${editRow.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (!res.ok) { setEditErr('Failed to save'); return }
      setProducts(prev => prev.map(p => p.id === editRow.id
        ? {
            ...p,
            catalogDescription: editDesc || null,
            defaultMarginPct:   editMarg || null,
            ...(photoChanged ? { googleDrivePhotoId: editPhotoId.trim() || null } : {}),
          }
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
        <div className={`rounded-xl border px-5 py-4 text-sm space-y-2 ${
          scanResult.dryRun
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="font-semibold">
              {scanResult.dryRun
                ? `Preview — ${scanResult.driveFiles} Drive files scanned (no changes saved)`
                : `Photo scan complete — ${scanResult.driveFiles} Drive files scanned`
              }
            </p>
            <div className="flex items-center gap-2">
            {scanResult.dryRun && scanResult.matched > 0 && (
              <button
                onClick={scanAllPhotos}
                disabled={scanning}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {scanning ? '⏳ Saving…' : `✓ Apply ${scanResult.matched} matches now`}
              </button>
            )}
            <button
              onClick={() => setScanResult(null)}
              aria-label="Dismiss"
              className="ml-1 text-lg leading-none opacity-50 hover:opacity-100 transition-opacity"
            >
              ×
            </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-green-700 font-medium">
              {scanResult.dryRun ? '◎' : '✓'} {scanResult.matched} {scanResult.dryRun ? 'would match' : 'newly matched'}
            </span>
            <span className="text-blue-600">↺ {scanResult.alreadySet} already set</span>
            <span className="text-gray-500">✕ {scanResult.notFound} not found</span>
            <span className="text-gray-400">— {scanResult.total} total products</span>
          </div>
          {/* Tier breakdown */}
          {scanResult.matched > 0 && Object.keys(scanResult.byTier).some(k => (scanResult.byTier[k] ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'exact',      label: 'Code (exact)',  cls: 'bg-blue-100 border-blue-300 text-blue-800' },
                { key: 'fuzzy',      label: 'Code (fuzzy)',  cls: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
                { key: 'name_exact', label: 'Name (exact)',  cls: 'bg-green-100 border-green-300 text-green-800' },
                { key: 'name_fuzzy', label: 'Name (fuzzy)',  cls: 'bg-teal-100 border-teal-300 text-teal-800' },
                { key: 'brand_name', label: 'Brand+Name',    cls: 'bg-purple-100 border-purple-300 text-purple-800' },
              ].filter(t => (scanResult.byTier[t.key] ?? 0) > 0).map(t => (
                <span key={t.key} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${t.cls}`}>
                  {t.label}: {scanResult.byTier[t.key]}
                </span>
              ))}
            </div>
          )}
          {/* Sample matched products */}
          {scanResult.matchedProducts.length > 0 && (
            <div className="mt-1">
              <p className="text-xs font-medium mb-1">
                {scanResult.dryRun ? 'Sample matches (first 50):' : 'New matches:'}
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {scanResult.matchedProducts.map((m, i) => {
                  const cls = m.how === 'exact'      ? 'bg-blue-50 border-blue-200 text-blue-700'
                            : m.how === 'fuzzy'      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : m.how === 'name_exact' ? 'bg-green-50 border-green-200 text-green-700'
                            : m.how === 'name_fuzzy' ? 'bg-teal-50 border-teal-200 text-teal-700'
                            :                         'bg-purple-50 border-purple-200 text-purple-700'
                  return (
                    <span key={i} className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
                      {m.code !== m.name ? m.code : m.name.slice(0, 30)}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {/* Unmatched codes */}
          {scanResult.unmatchedCodes.length > 0 && (
            <div className="mt-1">
              <p className="text-xs font-medium text-red-600 mb-1">
                Still unmatched ({scanResult.notFound} total, showing first {scanResult.unmatchedCodes.length}):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {scanResult.unmatchedCodes.map(c => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600">
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Rename Drive photos to match product names or codes, then scan again.
                Or open a product → Edit → paste a Drive file ID manually.
              </p>
            </div>
          )}
          {/* Drive filename diagnostic — helps understand naming convention */}
          {scanResult.sampleDriveFiles.length > 0 && (
            <div className="mt-2 pt-2 border-t border-amber-200">
              <p className="text-xs font-medium text-amber-800 mb-1">
                📁 Your Drive filenames (first {scanResult.sampleDriveFiles.length}) — check if these match your product names/codes:
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {scanResult.sampleDriveFiles.map((f, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-900 font-mono">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
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
          {/* Top-level categories (no parent) first, then subcategories grouped by parent */}
          {allCategories.filter(c => !c.parentName).map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
          {Array.from(
            allCategories.filter(c => c.parentName).reduce((m, c) => {
              const list = m.get(c.parentName!) ?? []
              list.push(c)
              m.set(c.parentName!, list)
              return m
            }, new Map<string, typeof allCategories>())
          ).sort((a, b) => a[0].localeCompare(b[0])).map(([parentName, subs]) => (
            <optgroup key={parentName} label={parentName}>
              {subs.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </optgroup>
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
        <button
          onClick={() => bulkSetVisible(true, true)}
          disabled={bulkBusy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {bulkBusy ? '…' : '📷 Mark Photos Visible'}
        </button>
        <div className="flex-1" />
        <button
          onClick={previewMatch}
          disabled={previewing || scanning}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 transition-colors"
        >
          {previewing ? '⏳ Previewing…' : '🔍 Preview Match'}
        </button>
        <button
          onClick={scanAllPhotos}
          disabled={scanning || previewing}
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
                  <td className="px-4 py-2.5">
                    {p.googleDrivePhotoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/portal/photo/${p.id}`}
                        alt={p.name}
                        className="w-10 h-10 object-contain rounded border border-gray-100 bg-gray-50"
                        loading="lazy"
                        onError={e => {
                          const t = e.currentTarget
                          t.style.display = 'none'
                          const sibling = t.nextElementSibling as HTMLElement | null
                          if (sibling) sibling.style.display = 'inline'
                        }}
                      />
                    ) : null}
                    <span
                      className="text-xs text-gray-300"
                      style={{ display: p.googleDrivePhotoId ? 'none' : 'inline' }}
                    >
                      —
                    </span>
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
                        onClick={() => { setEditRow(p); setEditDesc(p.catalogDescription ?? ''); setEditMarg(p.defaultMarginPct ?? ''); setEditPhotoId(p.googleDrivePhotoId ?? ''); setEditErr(null) }}
                        disabled={isBusy}
                        className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        Edit
                      </button>
                      {!p.googleDrivePhotoId && (
                        <button
                          onClick={() => findPhoto(p)}
                          disabled={isBusy}
                          title="Find photo by code or name"
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
            {/* Photo ID */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Google Drive Photo File ID
                <span className="text-gray-400 font-normal ml-1">(paste from Drive file URL)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editPhotoId}
                  onChange={e => setEditPhotoId(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
                  placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs"
                />
                {editPhotoId && (
                  <button
                    type="button"
                    onClick={() => setEditPhotoId('')}
                    className="px-2 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>
              {editPhotoId && editPhotoId === editRow?.googleDrivePhotoId && (
                <div className="mt-2 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/portal/photo/${editRow.id}`}
                    alt="Current photo"
                    className="w-16 h-16 object-contain rounded border border-gray-200 bg-gray-50"
                  />
                  <p className="text-xs text-gray-400">Current photo</p>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                To find a file ID: right-click the file in Google Drive → Get link → copy the ID from the URL.
                <br />
                Leave blank to remove the photo.
              </p>
            </div>

            {editErr && <p className="text-xs text-red-600">{editErr}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
