'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ProductCard from './ProductCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiProduct = {
  id:                 string
  name:               string
  brand:              string | null
  unit:               string | null
  qneItemCode:        string | null
  category:           { id: string; name: string }
  catalogDescription: string | null
  hasPhoto:           boolean
  sellingPrice:       string | null
  currency:           string
}

export type Category = { id: string; name: string }

// ---------------------------------------------------------------------------
// Module-level cache — survives React re-renders, component unmount/remount,
// and Back button navigation. Cleared only on a full page refresh.
// Keyed by session type so B2B and guest prices don't cross-contaminate.
// ---------------------------------------------------------------------------

type CacheEntry = { data: ApiProduct[]; fetchedAt: number }
const productCache = new Map<string, CacheEntry>()
let inflightPromise: Promise<ApiProduct[]> | null = null

async function loadAllProducts(cacheKey: string): Promise<ApiProduct[]> {
  const cached = productCache.get(cacheKey)
  // Serve from cache if less than 5 minutes old
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
    return cached.data
  }
  // Deduplicate concurrent fetches (e.g. React Strict Mode double-invoke)
  if (inflightPromise) return inflightPromise
  inflightPromise = fetch('/api/portal/products?limit=all')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<ApiProduct[]>
    })
    .then(data => {
      productCache.set(cacheKey, { data, fetchedAt: Date.now() })
      inflightPromise = null
      return data
    })
    .catch(err => {
      inflightPromise = null
      throw err
    })
  return inflightPromise
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
          <div className="aspect-square bg-gray-100" />
          <div className="p-4 space-y-2.5">
            <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
            <div className="h-3.5 bg-gray-100 rounded-full w-full" />
            <div className="h-3.5 bg-gray-100 rounded-full w-3/4" />
            <div className="h-3 bg-gray-100 rounded-full w-1/2" />
            <div className="h-5 bg-gray-100 rounded-full w-2/5 mt-2" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProductsClientPage({
  categories,
  initialCategoryId,
  initialQ,
  isB2B,
}: {
  categories:          Category[]
  initialCategoryId?:  string
  initialQ?:           string
  isB2B:               boolean
}) {
  const router     = useRouter()
  const cacheKey   = isB2B ? 'b2b' : 'guest'

  const [allProducts,   setAllProducts]   = useState<ApiProduct[] | null>(null)
  const [loadError,     setLoadError]     = useState(false)
  const [activeCategory, setActiveCategory] = useState(initialCategoryId ?? '')
  const [searchInput,   setSearchInput]   = useState(initialQ ?? '')
  const [searchQuery,   setSearchQuery]   = useState(initialQ ?? '')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>()

  // ------------------------------------------------------------------
  // Load all products once (or from cache)
  // ------------------------------------------------------------------
  useEffect(() => {
    // Already have a cached result — set it immediately (no loading flash)
    const cached = productCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
      setAllProducts(cached.data)
      return
    }
    setAllProducts(null) // show skeleton
    loadAllProducts(cacheKey)
      .then(data => setAllProducts(data))
      .catch(() => setLoadError(true))
  }, [cacheKey])

  // ------------------------------------------------------------------
  // Debounced live search
  // ------------------------------------------------------------------
  function handleSearchChange(value: string) {
    setSearchInput(value)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setSearchQuery(value), 250)
  }

  // ------------------------------------------------------------------
  // Client-side filter — instant after initial load
  // ------------------------------------------------------------------
  const filtered = useMemo(() => {
    if (!allProducts) return []
    const q = searchQuery.trim().toLowerCase()
    return allProducts.filter(p => {
      const matchCat = !activeCategory || p.category.id === activeCategory
      const matchQ   = !q ||
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? '').toLowerCase().includes(q) ||
        (p.qneItemCode ?? '').toLowerCase().includes(q)
      return matchCat && matchQ
    })
  }, [allProducts, activeCategory, searchQuery])

  // Product count per category (for badges) — computed once when allProducts loads
  const countByCategory = useMemo(() => {
    if (!allProducts) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const p of allProducts) {
      m.set(p.category.id, (m.get(p.category.id) ?? 0) + 1)
    }
    return m
  }, [allProducts])

  // ------------------------------------------------------------------
  // Category selection — updates state + syncs URL (no page navigation)
  // ------------------------------------------------------------------
  function selectCategory(id: string) {
    setActiveCategory(id)
    const params = new URLSearchParams()
    if (id) params.set('categoryId', id)
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    const qs = params.toString()
    router.replace(`/shop/products${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  function clearAll() {
    setSearchInput('')
    setSearchQuery('')
    setActiveCategory('')
    router.replace('/shop/products', { scroll: false })
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = searchInput.trim()
    setSearchQuery(q)
    const params = new URLSearchParams()
    if (activeCategory) params.set('categoryId', activeCategory)
    if (q) params.set('q', q)
    const qs = params.toString()
    router.replace(`/shop/products${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  const isLoading = allProducts === null && !loadError

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="flex gap-6 lg:gap-8">

      {/* ── Category sidebar ─────────────────────────────────────── */}
      <aside className="w-44 lg:w-48 shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">
          Categories
        </h2>
        <nav className="space-y-0.5">

          <button
            onClick={() => selectCategory('')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${
              !activeCategory
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span>All Products</span>
            {allProducts && (
              <span className={`text-xs tabular-nums ${!activeCategory ? 'text-blue-400' : 'text-gray-400 group-hover:text-gray-500'}`}>
                {allProducts.length.toLocaleString()}
              </span>
            )}
          </button>

          {categories.map(cat => {
            const count   = countByCategory.get(cat.id) ?? 0
            const active  = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="truncate pr-1">{cat.name}</span>
                {allProducts && count > 0 && (
                  <span className={`text-xs tabular-nums shrink-0 ${active ? 'text-blue-400' : 'text-gray-400 group-hover:text-gray-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* Search bar */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
            </svg>
            <input
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition bg-white"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setSearchQuery('') }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {(searchInput || activeCategory) && (
            <button
              type="button"
              onClick={clearAll}
              className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors whitespace-nowrap"
            >
              Clear all
            </button>
          )}
        </form>

        {/* Status row */}
        <div className="flex items-center gap-3 flex-wrap">
          {isB2B && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              B2B pricing applied
            </span>
          )}
          <p className="text-sm text-gray-500">
            {isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                Loading catalogue…
              </span>
            ) : loadError ? (
              <span className="text-red-500">
                Failed to load products.{' '}
                <button onClick={() => { setLoadError(false); loadAllProducts(cacheKey).then(setAllProducts).catch(() => setLoadError(true)) }} className="underline hover:no-underline">
                  Retry
                </button>
              </span>
            ) : (
              <>
                <strong className="text-gray-700 font-semibold">{filtered.length.toLocaleString()}</strong>
                {' '}product{filtered.length !== 1 ? 's' : ''}
                {searchQuery && (
                  <> matching &ldquo;<strong className="text-gray-700">{searchQuery}</strong>&rdquo;</>
                )}
                {activeCategory && !searchQuery && (
                  <> in <strong className="text-gray-700">{categories.find(c => c.id === activeCategory)?.name}</strong></>
                )}
              </>
            )}
          </p>
        </div>

        {/* Product grid */}
        {isLoading ? (
          <SkeletonGrid />
        ) : loadError ? null : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500 text-sm font-medium">No products found</p>
            <p className="text-gray-400 text-xs mt-1 mb-4">
              {searchQuery ? `Nothing matched "${searchQuery}"` : 'This category has no visible products yet'}
            </p>
            <button onClick={clearAll} className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(p => (
              <ProductCard
                key={p.id}
                id={p.id}
                name={p.name}
                brand={p.brand}
                unit={p.unit}
                categoryName={p.category.name}
                sellingPrice={p.sellingPrice}
                currency={p.currency}
                hasPhoto={p.hasPhoto}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
