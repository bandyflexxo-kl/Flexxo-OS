'use client'
/**
 * QuickReorderSection — "Quick Reorder" button + slide-in drawer panel.
 *
 * Receives frequentItems from the server component (computed from order history).
 * Client state: open/closed, search filter, per-item selected + qty.
 * On submit: calls POST /api/portal/cart/bulk → redirects to /shop/cart.
 */

import { useState, useMemo }  from 'react'
import { useRouter }           from 'next/navigation'
import Link                    from 'next/link'
import { Z }                   from '@/constants/zIndex'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FrequentItem = {
  productId:  string
  name:       string
  unit:       string | null
  orderCount: number
  lastQty:    number
}

type ItemState = {
  productId: string
  qty:       number
  selected:  boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuickReorderSection({
  frequentItems,
  branchOptions = [],
  itemsByBranch,
}: {
  frequentItems: FrequentItem[]
  branchOptions?: { id: string; name: string }[]
  itemsByBranch?: Record<string, FrequentItem[]>
}) {
  const router = useRouter()

  const [open,  setOpen]  = useState(false)
  const [items, setItems] = useState<ItemState[]>([])
  const [search, setSearch] = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done,  setDone]  = useState(false)
  const [branch, setBranch] = useState('all')   // A3: which branch's history to view

  // The active item source = the selected branch's history (falls back to all).
  const activeItems = (itemsByBranch?.[branch] ?? frequentItems)

  // ── Actions ─────────────────────────────────────────────────────────────────

  function seedItems(source: FrequentItem[]) {
    setItems(source.map(item => ({
      productId: item.productId,
      qty:       Math.max(1, item.lastQty),
      selected:  true,
    })))
  }

  function openDrawer() {
    seedItems(activeItems)
    setSearch('')
    setError(null)
    setDone(false)
    setOpen(true)
  }

  function changeBranch(id: string) {
    setBranch(id)
    seedItems(itemsByBranch?.[id] ?? frequentItems)
  }

  function closeDrawer() {
    if (busy) return
    setOpen(false)
  }

  function toggleItem(productId: string) {
    setItems(prev => prev.map(i =>
      i.productId === productId ? { ...i, selected: !i.selected } : i
    ))
  }

  function updateQty(productId: string, raw: number) {
    const qty = isNaN(raw) ? 1 : Math.max(1, Math.min(9999, raw))
    setItems(prev => prev.map(i =>
      i.productId === productId ? { ...i, qty } : i
    ))
  }

  function toggleAll() {
    const allOn = items.every(i => i.selected)
    setItems(prev => prev.map(i => ({ ...i, selected: !allOn })))
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  // Items visible in current search (subset of the active branch's items)
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeItems
    return activeItems.filter(fi => fi.name.toLowerCase().includes(q))
  }, [activeItems, search])

  const visibleIds = useMemo(
    () => new Set(visibleItems.map(fi => fi.productId)),
    [visibleItems]
  )

  // Count selected items that are currently visible
  const selectedCount = items.filter(i => i.selected && visibleIds.has(i.productId)).length

  // Quick lookup: productId → ItemState
  const stateMap = useMemo(
    () => new Map(items.map(i => [i.productId, i])),
    [items]
  )

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleAddToCart() {
    const toAdd = items.filter(i => i.selected && visibleIds.has(i.productId))
    if (toAdd.length === 0) { setError('Select at least one item.'); return }

    setBusy(true)
    setError(null)

    try {
      const res  = await fetch('/api/portal/cart/bulk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          items: toAdd.map(i => ({ productId: i.productId, qty: i.qty })),
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; addedCount?: number; skippedCount?: number }

      if (!res.ok) {
        setError(data.error ?? 'Failed to add items. Please try again.')
        return
      }

      setDone(true)
      // Brief "done" flash, then navigate to cart
      setTimeout(() => {
        setOpen(false)
        router.push('/shop/cart')
      }, 400)

    } catch {
      setError('Network error — please check your connection.')
    } finally {
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Trigger button ────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={openDrawer}
        className="w-full flex items-center justify-between bg-gradient-to-r from-green-700 to-green-600 text-white rounded-xl px-4 py-4 shadow-sm hover:from-green-800 hover:to-green-700 active:scale-[0.99] transition-all group"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🔄</span>
          <div className="text-left">
            <p className="text-sm font-bold leading-snug">Quick Reorder</p>
            <p className="text-xs text-green-200 mt-0.5">
              {frequentItems.length > 0
                ? `${frequentItems.length} item${frequentItems.length !== 1 ? 's' : ''} from your order history — one click to cart`
                : 'Reorder your usual items instantly — powered by your order history'
              }
            </p>
          </div>
        </div>
        <svg
          className="w-5 h-5 text-green-300 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
        </svg>
      </button>

      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ zIndex: Z.modalBackdrop }}
        onClick={closeDrawer}
        aria-hidden
      />

      {/* ── Drawer panel ──────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ zIndex: Z.modal }}
        role="dialog"
        aria-modal="true"
        aria-label="Quick Reorder"
      >

        {/* Header */}
        <div className="bg-gradient-to-r from-green-700 to-green-600 px-4 py-4 flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-bold text-white leading-tight">🔄 Quick Reorder</p>
            <p className="text-[11px] text-green-200 mt-0.5">
              Select items · adjust quantities · add to cart
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            disabled={busy}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Search + controls */}
        <div className="px-4 py-3 border-b border-gray-100 space-y-2.5 shrink-0 bg-white">
          {branchOptions.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Branch order history</label>
              <select
                value={branch}
                onChange={e => changeBranch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100"
              >
                <option value="all">All branches</option>
                {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
            </svg>
            <input
              type="text"
              placeholder="Filter items…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear filter"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-green-600 hover:text-green-700 transition-colors"
            >
              {items.every(i => i.selected) ? 'Deselect All' : 'Select All'}
            </button>
            <p className="text-xs text-gray-400">
              {selectedCount > 0
                ? <span className="text-green-600 font-medium">{selectedCount}</span>
                : '0'
              }{' '}of {visibleItems.length} selected
            </p>
          </div>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {frequentItems.length === 0 ? (
            /* No order history yet */
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <span className="text-4xl mb-4">📦</span>
              <p className="text-sm font-semibold text-gray-700">No order history yet</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-xs">
                Once you&rsquo;ve placed your first order, your frequently bought items will appear here so you can reorder them in one tap.
              </p>
              <Link
                href="/shop/products"
                onClick={closeDrawer}
                className="mt-5 px-5 py-2 bg-green-600 text-white text-xs font-semibold rounded-xl hover:bg-green-700 transition-colors"
              >
                Browse Products →
              </Link>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-gray-400">No items match &ldquo;{search}&rdquo;</p>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-2 text-xs text-green-600 hover:underline"
              >
                Clear filter
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {visibleItems.map(fi => {
                const state      = stateMap.get(fi.productId)
                const isSelected = state?.selected ?? false
                const qty        = state?.qty ?? fi.lastQty

                return (
                  <li
                    key={fi.productId}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                      isSelected ? 'bg-white hover:bg-green-50/40' : 'bg-gray-50/60'
                    }`}
                  >
                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={() => toggleItem(fi.productId)}
                      aria-checked={isSelected}
                      role="checkbox"
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${fi.name}`}
                      className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-green-600 border-green-600'
                          : 'border-gray-300 bg-white hover:border-green-400'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                      )}
                    </button>

                    {/* Product info */}
                    <div className={`flex-1 min-w-0 ${isSelected ? '' : 'opacity-40'}`}>
                      <p className="text-xs font-medium text-gray-900 leading-snug line-clamp-2">
                        {fi.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {fi.unit && (
                          <span className="text-[10px] text-gray-400">{fi.unit}</span>
                        )}
                        <span className="text-[10px] text-green-600 font-medium">
                          ordered {fi.orderCount}×
                        </span>
                      </div>
                    </div>

                    {/* Qty spinner */}
                    <div className={`flex items-center gap-1 shrink-0 ${isSelected ? '' : 'opacity-40 pointer-events-none'}`}>
                      <button
                        type="button"
                        onClick={() => updateQty(fi.productId, qty - 1)}
                        disabled={qty <= 1}
                        aria-label="Decrease quantity"
                        className="w-6 h-6 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4"/>
                        </svg>
                      </button>
                      <input
                        type="number"
                        min={1} max={9999}
                        value={qty}
                        onChange={e => updateQty(fi.productId, parseInt(e.target.value, 10))}
                        aria-label={`Quantity for ${fi.name}`}
                        className="w-12 text-center text-xs border border-gray-200 rounded-lg py-1 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100 bg-white transition"
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(fi.productId, qty + 1)}
                        aria-label="Increase quantity"
                        className="w-6 h-6 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                        </svg>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-100 bg-white shrink-0 space-y-2">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={busy || selectedCount === 0}
            className="w-full py-3 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {done ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
                Added! Going to cart…
              </>
            ) : busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Adding to Cart…
              </>
            ) : (
              <>
                🛒 Add {selectedCount} Item{selectedCount !== 1 ? 's' : ''} to Cart
              </>
            )}
          </button>
          <button
            type="button"
            onClick={closeDrawer}
            disabled={busy}
            className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>

      </div>
    </>
  )
}
