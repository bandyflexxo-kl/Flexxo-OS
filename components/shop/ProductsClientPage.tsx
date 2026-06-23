'use client'

import {
  useState, useEffect, useMemo, useRef,
} from 'react'

// ---------------------------------------------------------------------------
// SSR-safe mounted flag — used to prevent hydration mismatches on any
// logic that reads browser-only APIs (sessionStorage, window, etc.)
// ---------------------------------------------------------------------------
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ProductCard from './ProductCard'
import FlexxoSpinner from './FlexxoSpinner'
import { Z } from '@/constants/zIndex'
import type { ProductListItem } from '@/lib/products-api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiProduct = {
  id:          string
  name:        string
  brand:       string | null
  unit:        string | null
  qneItemCode: string | null
  category:    { id: string; name: string }
  hasPhoto:    boolean
  sellingPrice: string | null
  currency:    string
  availableQty?: number | null   // QNE stock; null/undefined = not yet synced
  // catalogDescription removed — it lives on the product detail page only.
  // Removing it from the listing API payload saves ~400 KB per request.
}

export type Category = { id: string; name: string; parentCategoryId?: string | null }

type CategoryNode = Category & { children: Category[] }

// ---------------------------------------------------------------------------
// Module-level product cache
// ---------------------------------------------------------------------------

// Guest users → /api/portal/products-public  (no cookies → Vercel CDN ISR-caches for 5 min)
// B2B clients → /api/portal/products         (dynamic, reads session for B2B pricing)
const GUEST_API_URL = '/api/portal/products-public?limit=all'
const B2B_API_URL   = '/api/portal/products?limit=all'

// Cards rendered per "page" of infinite scroll.
// Keeps DOM small so category switching (~60 reconciles) is instant.
const PAGE_SIZE = 30

type CacheEntry = { data: ApiProduct[]; fetchedAt: number }
const productCache    = new Map<string, CacheEntry>()
// keyed by cacheKey so B2B and guest inflight requests don't collide
const inflightByKey   = new Map<string, Promise<ApiProduct[]>>()

async function loadAllProducts(cacheKey: string, apiUrl: string): Promise<ApiProduct[]> {
  const cached = productCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return cached.data
  const existing = inflightByKey.get(cacheKey)
  if (existing) return existing
  // No { cache: 'no-store' } — let browser respect the response Cache-Control header.
  // products-public returns Cache-Control: public, max-age=86400 so the browser
  // will serve subsequent fetches from disk cache instantly (no network).
  const promise = fetch(apiUrl)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ApiProduct[]> })
    .then(data => { productCache.set(cacheKey, { data, fetchedAt: Date.now() }); inflightByKey.delete(cacheKey); return data })
    .catch(err => { inflightByKey.delete(cacheKey); throw err })
  inflightByKey.set(cacheKey, promise)
  return promise
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
        <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="aspect-square animate-shimmer" />
          <div className="p-4 space-y-2.5">
            <div className="h-2.5 animate-shimmer rounded-full w-1/3" />
            <div className="h-3.5 animate-shimmer rounded-full w-full" />
            <div className="h-3.5 animate-shimmer rounded-full w-3/4" />
            <div className="h-5 animate-shimmer rounded-full w-2/5 mt-2" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BarcodeScanner — uses native BarcodeDetector API (Chrome / Edge / Android)
// ---------------------------------------------------------------------------

function BarcodeScanner({ onScan, onClose }: {
  onScan:  (code: string) => void
  onClose: () => void
}) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Stabilise onScan so the effect dep array stays clean
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    let stream:   MediaStream | null = null
    let interval: ReturnType<typeof setInterval> | null = null

    async function start() {
      // Feature-detect
      if (!('BarcodeDetector' in window)) {
        setErr('Barcode scanning requires Chrome or Edge on Android/desktop. Try the photo search instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setReady(true)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'],
        })

        interval = setInterval(async () => {
          if (!videoRef.current) return
          try {
            const results = await detector.detect(videoRef.current) as Array<{ rawValue: string }>
            if (results.length > 0) {
              clearInterval(interval!)
              onScanRef.current(results[0].rawValue)
            }
          } catch { /* ignore per-frame errors */ }
        }, 500)
      } catch {
        setErr('Could not access camera. Please grant camera permission and try again.')
      }
    }

    start()
    return () => {
      if (interval) clearInterval(interval)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: Z.modal }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl w-full sm:max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h2M4 10h2M4 14h2M4 18h2M8 6v12M18 6v12M12 6v12M16 6h2M16 10h2M16 14h2M16 18h2"/>
            </svg>
            <h3 className="font-semibold text-gray-900 text-sm">Scan Barcode</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {err ? (
          <div className="px-6 py-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            </div>
            <p className="text-sm text-gray-600">{err}</p>
          </div>
        ) : (
          <div className="relative bg-black aspect-[4/3] overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {/* Aiming reticle */}
            {ready && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-52 h-28">
                  {/* Corner brackets */}
                  {(['tl','tr','bl','br'] as const).map(corner => (
                    <span key={corner} className={`absolute w-6 h-6 border-green-400 border-2 ${
                      corner === 'tl' ? 'top-0 left-0 border-r-0 border-b-0 rounded-tl' :
                      corner === 'tr' ? 'top-0 right-0 border-l-0 border-b-0 rounded-tr' :
                      corner === 'bl' ? 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl' :
                                        'bottom-0 right-0 border-l-0 border-t-0 rounded-br'
                    }`} />
                  ))}
                  {/* Scan line */}
                  <div className="absolute left-1 right-1 top-1/2 h-0.5 bg-green-400/70" />
                </div>
              </div>
            )}
          </div>
        )}

        <p className="px-4 py-3 text-xs text-gray-400 text-center">
          {err ? 'Try the 📷 photo search instead' : 'Point camera at barcode or QR code · scanning automatically'}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProductsClientPage({
  categories,
  initialProducts,
  initialCategoryId,
  initialQ,
  isB2B,
}: {
  categories:          Category[]
  /** Products pre-fetched server-side. When provided, skips the client-side
   *  API fetch entirely — the catalogue is available on first render. */
  initialProducts?:    ProductListItem[] | null
  initialCategoryId?:  string
  initialQ?:           string
  isB2B:               boolean
}) {
  const router   = useRouter()
  const cacheKey = isB2B ? 'b2b' : 'guest'
  // mounted is false during SSR and the first synchronous client render,
  // becoming true only after hydration completes. This ensures any
  // browser-API-dependent state (sessionStorage, window) never causes a
  // hydration mismatch.
  const mounted  = useMounted()

  // ── Product data ──────────────────────────────────────────────────
  // Priority order for initial state:
  //   1. initialProducts (SSR — server passed data via Redis cache)
  //   2. module-level productCache (SPA navigation — survives client-side nav)
  //   3. null → triggers client-side fetch → shows skeleton
  //
  // With SSR in place (#1), the skeleton should NEVER show for normal visits.
  // The module-level cache (#2) is a fallback for SPA navigations where the
  // server component doesn't re-run (Next.js uses the client component directly).
  const [allProducts, setAllProducts] = useState<ApiProduct[] | null>(() => {
    // Prefer server-provided data (no network round-trip needed)
    if (initialProducts && initialProducts.length > 0) return initialProducts
    // Fallback: module-level cache from a previous SPA navigation
    const key    = isB2B ? 'b2b' : 'guest'
    const cached = productCache.get(key)
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return cached.data
    return null
  })
  const [loadError,      setLoadError]      = useState(false)

  // ── Category tree (two-level: parent ← QNE category, child ← QNE group) ──
  const categoryTree = useMemo<CategoryNode[]>(() => {
    const parents = categories.filter(c => !c.parentCategoryId)
    return parents.map(p => ({
      ...p,
      children: categories.filter(c => c.parentCategoryId === p.id),
    }))
  }, [categories])

  // parentId → all descendant ids (parent itself + children) for filtering
  const idsUnderParent = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const node of categoryTree) m.set(node.id, [node.id, ...node.children.map(c => c.id)])
    return m
  }, [categoryTree])

  // childId → parentId, for auto-expanding the right parent
  const parentOfChild = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) if (c.parentCategoryId) m.set(c.id, c.parentCategoryId)
    return m
  }, [categories])

  // ── Filters ───────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState(initialCategoryId ?? '')
  // Parents whose subcategory list is expanded in the sidebar.
  // Seed with the active category's parent so deep links open expanded.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    const init = initialCategoryId ?? ''
    if (!init) return new Set()
    const parent = categories.find(c => c.id === init)?.parentCategoryId
    return new Set([parent ?? init])
  })
  const [searchInput,    setSearchInput]    = useState(initialQ ?? '')
  const [searchQuery,    setSearchQuery]    = useState(initialQ ?? '')

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Infinite scroll ───────────────────────────────────────────────
  // Only PAGE_SIZE cards are in the DOM at a time. An IntersectionObserver
  // watches a sentinel div below the grid; when it nears the viewport
  // (rootMargin: 300px) more cards are appended. Works identically on
  // desktop wheel-scroll and mobile touch-scroll.
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // ── Search dropdown ───────────────────────────────────────────────
  const [dropdownOpen,   setDropdownOpen]   = useState(false)
  const [highlightIdx,   setHighlightIdx]   = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef   = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Photo / Barcode search ────────────────────────────────────────
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)
  const [photoSearching,     setPhotoSearching]     = useState(false)
  const [photoDetectedQuery, setPhotoDetectedQuery] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── Load products ─────────────────────────────────────────────────
  // Guests use the CDN-cached public endpoint; B2B clients use the dynamic route.
  const apiUrl = isB2B ? B2B_API_URL : GUEST_API_URL
  useEffect(() => {
    // If server passed initialProducts, data is already in state — no fetch needed.
    // This is the normal path for all page loads (SSR + Redis cache).
    if (initialProducts && initialProducts.length > 0) return

    const cached = productCache.get(cacheKey)
    // If module-level cache is warm (SPA navigation), skip fetch.
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return
    // Cache miss — fetch. Keep showing stale data if any; don't blank the grid.
    loadAllProducts(cacheKey, apiUrl).then(setAllProducts).catch(() => setLoadError(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, apiUrl])

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
    setDisplayCount(PAGE_SIZE)
    saveRecentSearch(q)
    setRecentSearches(getRecentSearches())
    pushUrl(activeCategory, q)
  }

  function handleSubmitSearch() {
    const q = searchInput.trim()
    setSearchQuery(q)
    setDropdownOpen(false)
    setHighlightIdx(-1)
    setDisplayCount(PAGE_SIZE)
    if (q) { saveRecentSearch(q); setRecentSearches(getRecentSearches()) }
    pushUrl(activeCategory, q)
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    handleSubmitSearch()
  }

  // ── URL sync ─────────────────────────────────────────────────────
  // Use the native history API instead of router.replace() so the URL updates
  // for bookmarking/sharing WITHOUT triggering a Next.js server navigation
  // (which would re-run the server component + Prisma query, adding 1-2 s delay).
  // Products are already in memory — filtering is instant on the client.
  function pushUrl(catId: string, q: string) {
    const params = new URLSearchParams()
    if (catId) params.set('categoryId', catId)
    if (q) params.set('q', q)
    const qs = params.toString()
    window.history.replaceState(null, '', `/shop/products${qs ? `?${qs}` : ''}`)
  }

  function selectCategory(id: string) {
    setActiveCategory(id)
    setDisplayCount(PAGE_SIZE)  // reset scroll position on every category switch
    // Keep the relevant parent expanded: selecting a parent expands it,
    // selecting a child keeps its parent open, clearing collapses nothing.
    if (id) {
      const parent = parentOfChild.get(id) ?? id
      setExpandedParents(prev => new Set(prev).add(parent))
    }
    pushUrl(id, searchQuery)
  }

  function toggleExpand(parentId: string) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  function clearAll() {
    setSearchInput(''); setSearchQuery(''); setActiveCategory(''); setDropdownOpen(false)
    setDisplayCount(PAGE_SIZE)
    window.history.replaceState(null, '', '/shop/products')
  }

  // ── Photo search ──────────────────────────────────────────────────
  async function handlePhotoSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // allow re-selecting the same file
    setPhotoSearching(true)
    setPhotoDetectedQuery(null)
    try {
      const form = new FormData()
      form.append('image', file)
      const res  = await fetch('/api/portal/search/photo', { method: 'POST', body: form })
      const data = await res.json() as { matchId: string | null; query: string }
      if (data.matchId) {
        router.push(`/shop/products/${data.matchId}`)
      } else if (data.query) {
        applySearch(data.query)
        setPhotoDetectedQuery(data.query)
      }
    } catch { /* ignore */ } finally {
      setPhotoSearching(false)
    }
  }

  // ── Barcode scan result handler ───────────────────────────────────
  function handleBarcodeScan(code: string) {
    setShowBarcodeScanner(false)
    const exact = allProducts?.find(p => p.qneItemCode?.toLowerCase() === code.toLowerCase())
    if (exact) {
      router.push(`/shop/products/${exact.id}`)
    } else {
      applySearch(code)
    }
  }

  // ── Filtered product grid ─────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allProducts) return []
    const q = searchQuery.trim().toLowerCase()
    // Parent category active → match the parent itself + all its subcategories
    const catSet = activeCategory
      ? new Set(idsUnderParent.get(activeCategory) ?? [activeCategory])
      : null
    return allProducts.filter(p => {
      const matchCat = !catSet || catSet.has(p.category.id)
      const matchQ   = !q ||
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? '').toLowerCase().includes(q) ||
        (p.qneItemCode ?? '').toLowerCase().includes(q)
      return matchCat && matchQ
    })
  }, [allProducts, activeCategory, searchQuery, idsUnderParent])

  const countByCategory = useMemo(() => {
    if (!allProducts) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const p of allProducts) m.set(p.category.id, (m.get(p.category.id) ?? 0) + 1)
    // Roll child counts up into parents (parent count = own products + children's)
    for (const node of categoryTree) {
      const total = (m.get(node.id) ?? 0) + node.children.reduce((n, c) => n + (m.get(c.id) ?? 0), 0)
      if (total > 0) m.set(node.id, total)
    }
    return m
  }, [allProducts, categoryTree])

  // ── Infinite scroll observer ──────────────────────────────────────
  // Placed after `filtered` and `countByCategory` so both are in scope.
  // Re-wires whenever displayCount or filtered.length changes so the
  // observer always targets the current sentinel position.
  useEffect(() => {
    if (displayCount >= filtered.length) return   // nothing left to load
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setDisplayCount(c => c + PAGE_SIZE) },
      { rootMargin: '300px' },  // pre-load 300 px before user hits the bottom
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [displayCount, filtered.length])

  const isLoading = allProducts === null && !loadError
  const activeCategoryName = categories.find(c => c.id === activeCategory)?.name

  // Fix 6: Stagger animation guard — persisted in sessionStorage so it survives
  // client-side navigation back to this page without re-running the slide-in.
  // useRef(initialValue): on remount the ref re-initialises, but we seed it
  // from sessionStorage so it's true if the user has already seen the animation
  // this browser session.
  //
  // IMPORTANT: gate on `mounted` so SSR always renders without animation classes.
  // Without this, SSR renders className="animate-fade-in-up" but a returning
  // visitor's client render sees sessionStorage='1' → hasAnimated=true →
  // className="" → React hydration warning. By making isFirstLoad=false on the
  // server, both SSR and the initial client render agree on empty classNames;
  // animations fire on the very next micro-task after hydration completes.
  const SS_KEY = 'flexxo_products_animated'
  const hasAnimated = useRef<boolean>(false)
  // Read sessionStorage only after mount (browser-only API)
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SS_KEY) === '1') hasAnimated.current = true
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const isFirstLoad = mounted && !hasAnimated.current && allProducts !== null
  // Write sessionStorage in an effect (never during render — side effects in
  // render body fire on every render pass including server renders).
  useEffect(() => {
    if (isFirstLoad) {
      hasAnimated.current = true
      try { sessionStorage.setItem(SS_KEY, '1') } catch { /* ignore */ }
    }
  }, [isFirstLoad])

  // ── Dropdown content to show ──────────────────────────────────────
  const showSuggestions = dropdownOpen && searchInput.trim().length > 0
  const showRecents     = dropdownOpen && searchInput.trim().length === 0 && recentSearches.length > 0
  const showDropdown    = showSuggestions || showRecents

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Category emoji map for visual flavour on mobile pills
  const CAT_EMOJI: Record<string, string> = {
    'Office Stationery':            '✏️',
    'Office Furniture':             '🪑',
    'Printer Supplies':             '🖨️',
    'Computer Hardware & Software': '💻',
    'Office Security':              '🔒',
    'Office Machine':               '⚙️',
    'Office Equipment':             '🔧',
    'Breakroom':                    '☕',
    'Janitorial':                   '🧹',
    'Safety Kits':                  '🦺',
  }

  return (
    <div className="flex gap-6 lg:gap-8">

      {/* ── Category sidebar — desktop only ───────────────────────── */}
      <aside className="hidden lg:block w-48 shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">
          Categories
        </h2>
        <nav className="space-y-0.5">
          <button
            onClick={() => selectCategory('')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${
              !activeCategory ? 'bg-green-50 text-green-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span>All Products</span>
            {allProducts && (
              <span className={`text-xs tabular-nums ${!activeCategory ? 'text-green-400' : 'text-gray-400 group-hover:text-gray-500'}`}>
                {allProducts.length.toLocaleString()}
              </span>
            )}
          </button>

          {categoryTree.map(cat => {
            const count    = countByCategory.get(cat.id) ?? 0
            const active   = activeCategory === cat.id
            const expanded = expandedParents.has(cat.id)
            const hasKids  = cat.children.length > 0
            return (
              <div key={cat.id}>
                <div className={`w-full rounded-lg text-sm transition-colors flex items-center group ${
                  active ? 'bg-green-50 text-green-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                  <button
                    onClick={() => selectCategory(cat.id)}
                    className="flex-1 min-w-0 text-left px-3 py-2 flex items-center justify-between"
                  >
                    <span className="truncate pr-1">{cat.name}</span>
                    {allProducts && count > 0 && (
                      <span className={`text-xs tabular-nums shrink-0 ${active ? 'text-green-400' : 'text-gray-400 group-hover:text-gray-500'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                  {hasKids && (
                    <button
                      onClick={() => toggleExpand(cat.id)}
                      className="px-2 py-2 shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={expanded ? `Collapse ${cat.name}` : `Expand ${cat.name}`}
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Subcategories */}
                {hasKids && expanded && (
                  <div className="ml-3 border-l border-gray-200 pl-1 mt-0.5 mb-1 space-y-0.5">
                    {cat.children.map(sub => {
                      const subCount  = countByCategory.get(sub.id) ?? 0
                      const subActive = activeCategory === sub.id
                      return (
                        <button
                          key={sub.id}
                          onClick={() => selectCategory(sub.id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-md text-[13px] transition-colors flex items-center justify-between group ${
                            subActive ? 'bg-green-50 text-green-700 font-semibold' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                          }`}
                        >
                          <span className="truncate pr-1">{sub.name}</span>
                          {allProducts && subCount > 0 && (
                            <span className={`text-[11px] tabular-nums shrink-0 ${subActive ? 'text-green-400' : 'text-gray-400 group-hover:text-gray-500'}`}>
                              {subCount}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* ── Category grid — mobile only (all visible, no horizontal scroll) ── */}
        <div className="lg:hidden">
          {/* "All Products" spans full width */}
          <button
            onClick={() => selectCategory('')}
            className={`w-full flex items-center justify-between px-3.5 py-2 mb-2 rounded-xl text-xs font-semibold transition-all border touch-manipulation ${
              !activeCategory
                ? 'bg-green-600 text-white border-green-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
            }`}
          >
            <span className="flex items-center gap-1.5">🏪 All Products</span>
            {allProducts && (
              <span className={`tabular-nums text-[10px] ${!activeCategory ? 'text-green-100' : 'text-gray-400'}`}>
                {allProducts.length.toLocaleString()}
              </span>
            )}
          </button>

          {/* 2-column grid — all 10 parent categories visible at once */}
          <div className="grid grid-cols-2 gap-2">
            {categoryTree.map(cat => {
              const count  = countByCategory.get(cat.id) ?? 0
              const active = activeCategory === cat.id || parentOfChild.get(activeCategory) === cat.id
              const emoji  = CAT_EMOJI[cat.name] ?? '📋'
              return (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat.id)}
                  title={cat.name}
                  className={`flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all border touch-manipulation text-left ${
                    active
                      ? 'bg-green-600 text-white border-green-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-green-300 hover:bg-green-50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="shrink-0">{emoji}</span>
                    <span className="truncate leading-snug">{cat.name}</span>
                  </span>
                  {allProducts && count > 0 && (
                    <span className={`tabular-nums text-[10px] shrink-0 ml-auto pl-1 ${active ? 'text-green-100' : 'text-gray-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Subcategory pill row — scrollable strip, shown when a parent is active */}
          {(() => {
            const activeParentId = parentOfChild.get(activeCategory) ?? activeCategory
            const parentNode     = categoryTree.find(c => c.id === activeParentId)
            if (!parentNode || parentNode.children.length === 0) return null
            return (
              <div className="flex gap-2 overflow-x-auto pb-1 pt-3 no-scrollbar snap-x snap-mandatory">
                <button
                  onClick={() => selectCategory(parentNode.id)}
                  className={`shrink-0 snap-start px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border touch-manipulation ${
                    activeCategory === parentNode.id
                      ? 'bg-green-100 text-green-700 border-green-300'
                      : 'bg-white text-gray-500 border-gray-200'
                  }`}
                >
                  All {parentNode.name}
                </button>
                {parentNode.children.map(sub => {
                  const subCount  = countByCategory.get(sub.id) ?? 0
                  const subActive = activeCategory === sub.id
                  return (
                    <button
                      key={sub.id}
                      onClick={() => selectCategory(sub.id)}
                      className={`shrink-0 snap-start flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border touch-manipulation ${
                        subActive
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-white text-gray-500 border-gray-200'
                      }`}
                    >
                      {sub.name}
                      {allProducts && subCount > 0 && (
                        <span className="tabular-nums text-[10px] text-gray-400">{subCount}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* ── Search bar with dropdown ──────────────────────────── */}
        <div ref={dropdownRef} className="relative">
          <form onSubmit={handleFormSubmit}>
            <div className={`flex items-center gap-2 border bg-white rounded-xl px-3 py-2 transition-all ${
              dropdownOpen
                ? 'border-green-500 ring-2 ring-green-100 rounded-b-none border-b-0'
                : 'border-gray-300 hover:border-gray-400'
            }`}>
              {/* Search icon */}
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
              </svg>

              {/* Active category chip */}
              {activeCategoryName && (
                <span className="flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-md shrink-0 select-none">
                  <span className="text-green-400">in</span>
                  {activeCategoryName}
                  <button
                    type="button"
                    onClick={() => selectCategory('')}
                    className="ml-0.5 text-green-400 hover:text-green-700 transition-colors leading-none"
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

              {/* Divider */}
              <span className="w-px h-4 bg-gray-200 shrink-0" />

              {/* Barcode scanner button */}
              <button
                type="button"
                onClick={() => setShowBarcodeScanner(true)}
                className="shrink-0 p-1 text-gray-400 hover:text-green-600 transition-colors"
                aria-label="Scan barcode"
                title="Scan product barcode"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h2M4 10h2M4 14h2M4 18h2M8 6v12M18 6v12M12 6v12M16 6h2M16 10h2M16 14h2M16 18h2"/>
                </svg>
              </button>

              {/* Photo search button */}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoSearching}
                className="shrink-0 p-1 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50"
                aria-label="Search by photo"
                title="Search by product photo"
              >
                {photoSearching ? (
                  <FlexxoSpinner size="sm" color="green" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                )}
              </button>
            </div>
          </form>

          {/* ── Dropdown ──────────────────────────────────────────── */}
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full bg-white border border-green-500 border-t-0 rounded-b-xl shadow-lg overflow-hidden ring-2 ring-green-100 ring-t-0" style={{ zIndex: Z.searchDropdown }}>

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
                        highlightIdx === i ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'
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
                        highlightIdx === i ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Thumbnail — Fix 1: explicit 36×36 reserves layout space */}
                      <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center relative">
                        {p.hasPhoto ? (
                          <Image
                            src={`/api/portal/photo/${p.id}`}
                            alt={p.name}
                            width={36}
                            height={36}
                            unoptimized
                            className="w-full h-full object-contain p-1"
                          />
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
                          <span className="text-green-600">{p.category.name}</span>
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
                      highlightIdx === suggestions.length ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'
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

        {/* Hidden file input — triggered by the photo button above */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handlePhotoSearch}
        />

        {/* AI-detected query banner */}
        {photoDetectedQuery && (
          <div className="flex items-center gap-2 text-xs bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg -mt-2">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
            <span>AI identified: <strong>{photoDetectedQuery}</strong></span>
            <button
              type="button"
              onClick={() => setPhotoDetectedQuery(null)}
              className="ml-auto text-green-400 hover:text-green-700 transition-colors text-base leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

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
                <FlexxoSpinner size="sm" color="green" />
                Loading catalogue…
              </span>
            ) : loadError ? (
              <span className="text-red-500">
                Failed to load.{' '}
                <button onClick={() => { setLoadError(false); loadAllProducts(cacheKey, apiUrl).then(setAllProducts).catch(() => setLoadError(true)) }} className="underline text-red-600">
                  Retry
                </button>
              </span>
            ) : (
              <>
                <strong className="text-gray-700 font-semibold">{filtered.length.toLocaleString()}</strong>
                {' '}product{filtered.length !== 1 ? 's' : ''}
                {searchQuery && <> matching &ldquo;<strong className="text-green-700">{searchQuery}</strong>&rdquo;</>}
                {activeCategoryName && !searchQuery && <> in <strong className="text-green-700">{activeCategoryName}</strong></>}
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
            <button onClick={clearAll} className="text-sm text-green-600 hover:text-green-700 hover:underline transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {/* id used by HeroSection CTA scroll anchor */}
            <div id="products-grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.slice(0, displayCount).map((p, i) => {
                // Stagger first 4 cards on initial load
                const entryStyle = isFirstLoad && i < 4
                  ? { animationDelay: `${i * 75}ms` }
                  : {}
                return (
                  <div
                    key={p.id}
                    className={isFirstLoad && i < 4 ? 'animate-fade-in-up' : ''}
                    style={entryStyle}
                  >
                    <ProductCard
                      id={p.id}
                      name={p.name}
                      brand={p.brand}
                      unit={p.unit}
                      categoryName={p.category.name}
                      sellingPrice={p.sellingPrice}
                      currency={p.currency}
                      hasPhoto={p.hasPhoto}
                      availableQty={p.availableQty}
                      isB2B={isB2B}
                      priority={i < 4}
                    />
                  </div>
                )
              })}
            </div>

            {/* Sentinel — IntersectionObserver target. Sits just below the last
                rendered card. When it enters the viewport (rootMargin 300 px
                pre-trigger) the observer appends the next PAGE_SIZE cards.
                The spinner only shows while more items remain. */}
            <div ref={sentinelRef} className="flex justify-center py-6" aria-hidden>
              {displayCount < filtered.length && (
                <FlexxoSpinner size="sm" color="green" />
              )}
            </div>
          </>
        )}
      </div>

      {/* Barcode scanner modal */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={() => setShowBarcodeScanner(false)}
        />
      )}
    </div>
  )
}
