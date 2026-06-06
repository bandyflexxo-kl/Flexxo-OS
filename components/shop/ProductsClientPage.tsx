'use client'

import {
  useState, useEffect, useMemo, useRef, useCallback,
} from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
// Module-level product cache
// ---------------------------------------------------------------------------

type CacheEntry = { data: ApiProduct[]; fetchedAt: number }
const productCache = new Map<string, CacheEntry>()
let inflightPromise: Promise<ApiProduct[]> | null = null

async function loadAllProducts(cacheKey: string): Promise<ApiProduct[]> {
  const cached = productCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return cached.data
  if (inflightPromise) return inflightPromise
  inflightPromise = fetch('/api/portal/products?limit=all')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ApiProduct[]> })
    .then(data => { productCache.set(cacheKey, { data, fetchedAt: Date.now() }); inflightPromise = null; return data })
    .catch(err => { inflightPromise = null; throw err })
  return inflightPromise
}

// ---------------------------------------------------------------------------
// Recent searches — localStorage helper
// ---------------------------------------------------------------------------

const RECENT_KEY = 'flexxo_recent_searches'
const MAX_RECENT = 6

function getRecentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] }
  catch { return [] }
}

function saveRecentSearch(q: string) {
  const trimmed = q.trim()
  if (!trimmed) return
  try {
    const prev = getRecentSearches().filter(s => s.toLowerCase() !== trimmed.toLowerCase())
    localStorage.setItem(RECENT_KEY, JSON.stringify([trimmed, ...prev].slice(0, MAX_RECENT)))
  } catch { /* ignore */ }
}

function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Highlight matched text in a string
// ---------------------------------------------------------------------------

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim())
  if (idx === -1) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded-sm not-italic font-semibold px-0.5">
        {text.slice(idx, idx + query.trim().length)}
      </mark>
      {text.slice(idx + query.trim().length)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" aria-busy="true">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
          <div className="aspect-square bg-gray-100" />
          <div className="p-4 space-y-2.5">
            <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
            <div className="h-3.5 bg-gray-100 rounded-full w-full" />
            <div className="h-3.5 bg-gray-100 rounded-full w-3/4" />
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
  const router   = useRouter()
  const cacheKey = isB2B ? 'b2b' : 'guest'

  // ── Product data ──────────────────────────────────────────────────
  const [allProducts,    setAllProducts]    = useState<ApiProduct[] | null>(null)
  const [loadError,      setLoadError]      = useState(false)

  // ── Filters ───────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState(initialCategoryId ?? '')
  const [searchInput,    setSearchInput]    = useState(initialQ ?? '')
  const [searchQuery,    setSearchQuery]    = useState(initialQ ?? '')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>()

  // ── Search dropdown ───────────────────────────────────────────────
  const [dropdownOpen,   setDropdownOpen]   = useState(false)
  const [highlightIdx,   setHighlightIdx]   = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef   = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Load products ─────────────────────────────────────────────────
  useEffect(() => {
    const cached = productCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) { setAllProducts(cached.data); return }
    setAllProducts(null)
    loadAllProducts(cacheKey).then(setAllProducts).catch(() => setLoadError(true))
  }, [cacheKey])

  // ── Load recent searches on mount ─────────────────────────────────
  useEffect(() => { setRecentSearches(getRecentSearches()) }, [])

  // ── Global `/` key — focus search ─────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Click outside closes dropdown ─────────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setHighlightIdx(-1)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // ── Autocomplete suggestions (top 8 matching products) ───────────
  const suggestions = useMemo(() => {
    if (!allProducts || !searchInput.trim()) return []
    const q = searchInput.trim().toLowerCase()
    return allProducts
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? '').toLowerCase().includes(q) ||
        (p.qneItemCode ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [allProducts, searchInput])

  // ── Debounced filter query ─────────────────────────────────────────
  function handleSearchChange(value: string) {
    setSearchInput(value)
    setHighlightIdx(-1)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setSearchQuery(value), 250)
  }

  // ── Keyboard navigation in dropdown ───────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const items = searchInput.trim() ? suggestions : recentSearches
    if (!dropdownOpen) { if (e.key === 'ArrowDown') { setDropdownOpen(true); return } }
    if (e.key === 'Escape') { setDropdownOpen(false); setHighlightIdx(-1); inputRef.current?.blur(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(i => Math.min(i + 1, items.length - 1 + (searchInput.trim() ? 1 : 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, -1))
      return
    }
    if (e.key === 'Enter') {
      if (highlightIdx >= 0 && searchInput.trim() && highlightIdx < suggestions.length) {
        // Navigate to product detail
        e.preventDefault()
        router.push(`/shop/products/${suggestions[highlightIdx].id}`)
        setDropdownOpen(false)
        return
      }
      if (highlightIdx >= 0 && !searchInput.trim() && highlightIdx < recentSearches.length) {
        e.preventDefault()
        applySearch(recentSearches[highlightIdx])
        return
      }
      // Regular Enter → submit search
      handleSubmitSearch()
    }
  }

  // ── Apply a search term (from suggestion or recent) ───────────────
  function applySearch(q: string) {
    setSearchInput(q)
    setSearchQuery(q)
    setDropdownOpen(false)
    setHighlightIdx(-1)
    saveRecentSearch(q)
    setRecentSearches(getRecentSearches())
    pushUrl(activeCategory, q)
  }

  function handleSubmitSearch() {
    const q = searchInput.trim()
    setSearchQuery(q)
    setDropdownOpen(false)
    setHighlightIdx(-1)
    if (q) { saveRecentSearch(q); setRecentSearches(getRecentSearches()) }
    pushUrl(activeCategory, q)
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    handleSubmitSearch()
  }

  // ── URL sync ─────────────────────────────────────────────────────
  function pushUrl(catId: string, q: string) {
    const params = new URLSearchParams()
    if (catId) params.set('categoryId', catId)
    if (q) params.set('q', q)
    const qs = params.toString()
    router.replace(`/shop/products${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  function selectCategory(id: string) {
    setActiveCategory(id)
    pushUrl(id, searchQuery)
  }

  function clearAll() {
    setSearchInput(''); setSearchQuery(''); setActiveCategory(''); setDropdownOpen(false)
    router.replace('/shop/products', { scroll: false })
  }

  // ── Filtered product grid ─────────────────────────────────────────
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

  const countByCategory = useMemo(() => {
    if (!allProducts) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const p of allProducts) m.set(p.category.id, (m.get(p.category.id) ?? 0) + 1)
    return m
  }, [allProducts])

  const isLoading = allProducts === null && !loadError
  const activeCategoryName = categories.find(c => c.id === activeCategory)?.name

  // ── Dropdown content to show ──────────────────────────────────────
  const showSuggestions = dropdownOpen && searchInput.trim().length > 0
  const showRecents     = dropdownOpen && searchInput.trim().length === 0 && recentSearches.length > 0
  const showDropdown    = showSuggestions || showRecents

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex gap-6 lg:gap-8">

      {/* ── Category sidebar ──────────────────────────────────────── */}
      <aside className="w-44 lg:w-48 shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">
          Categories
        </h2>
        <nav className="space-y-0.5">
          <button
            onClick={() => selectCategory('')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${
              !activeCategory ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
            const count  = countByCategory.get(cat.id) ?? 0
            const active = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${
                  active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* ── Search bar with dropdown ──────────────────────────── */}
        <div ref={dropdownRef} className="relative">
          <form onSubmit={handleFormSubmit}>
            <div className={`flex items-center gap-2 border bg-white rounded-xl px-3 py-2 transition-all ${
              dropdownOpen
                ? 'border-blue-500 ring-2 ring-blue-100 rounded-b-none border-b-0'
                : 'border-gray-300 hover:border-gray-400'
            }`}>
              {/* Search icon */}
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
              </svg>

              {/* Active category chip */}
              {activeCategoryName && (
                <span className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-md shrink-0 select-none">
                  <span className="text-blue-400">in</span>
                  {activeCategoryName}
                  <button
                    type="button"
                    onClick={() => selectCategory('')}
                    className="ml-0.5 text-blue-400 hover:text-blue-700 transition-colors leading-none"
                    aria-label="Remove category filter"
                  >
                    ×
                  </button>
                </span>
              )}

              {/* Text input */}
              <input
                ref={inputRef}
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={activeCategoryName ? `Search in ${activeCategoryName}…` : 'Search products… (press / to focus)'}
                className="flex-1 min-w-0 text-sm outline-none bg-transparent placeholder-gray-400"
              />

              {/* Clear input */}
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearchQuery(''); setHighlightIdx(-1) }}
                  className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 text-lg leading-none"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}

              {/* Keyboard hint (hidden when focused) */}
              {!dropdownOpen && !searchInput && (
                <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs text-gray-400 font-mono shrink-0">
                  /
                </kbd>
              )}
            </div>
          </form>

          {/* ── Dropdown ──────────────────────────────────────────── */}
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full bg-white border border-blue-500 border-t-0 rounded-b-xl shadow-lg z-50 overflow-hidden ring-2 ring-blue-100 ring-t-0">

              {/* Recent searches */}
              {showRecents && (
                <>
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent searches</p>
                    <button
                      type="button"
                      onClick={() => { clearRecentSearches(); setRecentSearches([]) }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  {recentSearches.map((term, i) => (
                    <button
                      key={term}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); applySearch(term) }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                        highlightIdx === i ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <span>{term}</span>
                    </button>
                  ))}
                  <div className="border-t border-gray-100 px-4 py-2.5">
                    <p className="text-xs text-gray-400">Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">↵ Enter</kbd> to search all products</p>
                  </div>
                </>
              )}

              {/* Live suggestions */}
              {showSuggestions && suggestions.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Products</p>
                  </div>
                  {suggestions.map((p, i) => (
                    <Link
                      key={p.id}
                      href={`/shop/products/${p.id}`}
                      onMouseDown={e => { e.preventDefault(); saveRecentSearch(searchInput); setRecentSearches(getRecentSearches()) }}
                      onClick={() => setDropdownOpen(false)}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        highlightIdx === i ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                        {p.hasPhoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/portal/photo/${p.id}`} alt={p.name} loading="lazy" className="w-full h-full object-contain p-1" />
                        ) : (
                          <span className="text-gray-300 text-sm">📦</span>
                        )}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          <HighlightMatch text={p.name} query={searchInput} />
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {p.brand && <><HighlightMatch text={p.brand} query={searchInput} />{' · '}</>}
                          <span className="text-blue-500">{p.category.name}</span>
                        </p>
                      </div>
                      {/* Price */}
                      {p.sellingPrice && (
                        <p className="text-sm font-semibold text-gray-800 shrink-0">
                          {p.currency} {Number(p.sellingPrice).toFixed(2)}
                        </p>
                      )}
                    </Link>
                  ))}

                  {/* "See all results" footer */}
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); handleSubmitSearch() }}
                    className={`w-full flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm transition-colors ${
                      highlightIdx === suggestions.length ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>See all results for &ldquo;<strong>{searchInput}</strong>&rdquo;</span>
                    <span className="text-gray-400 text-xs">{filtered.length} products</span>
                  </button>
                </>
              )}

              {/* No suggestions */}
              {showSuggestions && suggestions.length === 0 && (
                <div className="px-4 py-4 text-sm text-gray-400 text-center">
                  No products matching &ldquo;{searchInput}&rdquo;
                  {activeCategoryName && (
                    <> in <span className="text-gray-600 font-medium">{activeCategoryName}</span></>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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
                Failed to load.{' '}
                <button onClick={() => { setLoadError(false); loadAllProducts(cacheKey).then(setAllProducts).catch(() => setLoadError(true)) }} className="underline">
                  Retry
                </button>
              </span>
            ) : (
              <>
                <strong className="text-gray-700 font-semibold">{filtered.length.toLocaleString()}</strong>
                {' '}product{filtered.length !== 1 ? 's' : ''}
                {searchQuery && <> matching &ldquo;<strong className="text-gray-700">{searchQuery}</strong>&rdquo;</>}
                {activeCategoryName && !searchQuery && <> in <strong className="text-gray-700">{activeCategoryName}</strong></>}
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
            <p className="text-gray-600 text-sm font-medium">No products found</p>
            <p className="text-gray-400 text-xs mt-1 mb-4">
              {searchQuery
                ? `Nothing matched "${searchQuery}"${activeCategoryName ? ` in ${activeCategoryName}` : ''}`
                : 'This category has no visible products yet'}
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
                isB2B={isB2B}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
