'use client'

/**
 * Accurate bulk searching (/admin/products?tab=bulk-search) — the admin enters
 * ONE official website, searches + selects the products to match, and photos are
 * pulled STRICTLY from that website only. Each found photo is AI-quality-checked
 * and queued in Photo Review; nothing goes live without approval.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'no-photo' | 'flagged' | 'has-photo'
type Product = { id: string; name: string; brand: string | null; code: string | null; status: Status; pending: boolean }
type Tier = 'exact' | 'similar' | 'none'
type Result = { productId: string; name: string; code: string | null; tier: Tier; source?: string | null; photoUrl?: string | null; flagged?: boolean; reason?: string }

const CONCURRENCY = 2

function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim()
}

export default function AccurateBulkSearchTab() {
  const [website, setWebsite] = useState('')
  const [search, setSearch]   = useState('')
  const [needsOnly, setNeedsOnly] = useState(true)
  const [products, setProducts]   = useState<Product[]>([])
  const [truncated, setTruncated] = useState(false)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [listLoading, setListLoading] = useState(false)

  const [phase, setPhase]     = useState<'idle' | 'running' | 'done'>('idle')
  const [done, setDone]       = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const [error, setError]     = useState<string | null>(null)
  const cancelRef = useRef(false)
  const debounce  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadProducts = useCallback(async (q: string, needs: boolean) => {
    setListLoading(true)
    try {
      const p = new URLSearchParams()
      if (q) p.set('search', q)
      if (needs) p.set('needsPhotoOnly', '1')
      const r = await fetch(`/api/admin/products/site-photo-search?${p}`)
      const d = await r.json() as { products: Product[]; truncated: boolean }
      setProducts(d.products ?? [])
      setTruncated(!!d.truncated)
    } catch { setError('Could not load products.') }
    finally { setListLoading(false) }
  }, [])

  useEffect(() => { void loadProducts('', true) }, [loadProducts])
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void loadProducts(search, needsOnly), 300)
    return () => clearTimeout(debounce.current)
  }, [search, needsOnly, loadProducts])

  const domain = cleanDomain(website)
  const canRun = domain.includes('.') && selected.size > 0 && phase !== 'running'

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAllShown() {
    setSelected(prev => { const n = new Set(prev); products.forEach(p => n.add(p.id)); return n })
  }

  async function run() {
    if (!canRun) return
    cancelRef.current = false
    setPhase('running'); setResults([]); setDone(0); setError(null)
    const ids = [...selected]
    let i = 0
    const worker = async () => {
      while (i < ids.length && !cancelRef.current) {
        const productId = ids[i++]
        try {
          const r = await fetch('/api/admin/products/site-photo-search', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, website: domain }),
          })
          const res = await r.json() as Result & { error?: string }
          if (!res.error) setResults(prev => [...prev, res])
        } catch { /* skip one, continue */ }
        finally { setDone(d => d + 1) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    setPhase('done')
    void loadProducts(search, needsOnly)
  }

  const matched  = results.filter(r => r.tier !== 'none')
  const notFound = results.filter(r => r.tier === 'none')

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3.5 text-sm text-green-900">
        <p className="font-semibold">Accurate bulk searching</p>
        <p className="text-green-800">
          Enter one official website, pick the products to match, and photos are taken <span className="font-medium">strictly from that website only</span> —
          results from any other site are discarded. Every photo is AI quality-checked and queued in{' '}
          <a href="/admin/products?tab=photos" className="underline font-medium">Photo Review</a>; nothing goes live until you approve it.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* Step 1 — website */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">1 · Official website</label>
        <input
          value={website}
          onChange={e => setWebsite(e.target.value)}
          placeholder="e.g. stpstationery.com.my"
          className="w-full max-w-md border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
        />
        {website && (
          <p className="text-xs text-gray-400 mt-1">
            Searching only: <span className="font-medium text-gray-600">{domain || '—'}</span>
          </p>
        )}
      </div>

      {/* Step 2 — select products */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700">2 · Select products <span className="text-gray-400 font-normal">({selected.size} selected)</span></label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={needsOnly} onChange={e => setNeedsOnly(e.target.checked)} className="accent-green-600" />
              Needs photo only
            </label>
            <button onClick={selectAllShown} className="text-xs font-medium text-green-600 hover:text-green-700">Select all shown</button>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>}
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code, or brand…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-green-400"
        />
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 max-h-80 overflow-y-auto">
          {listLoading && products.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">Loading…</p>
          ) : products.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">No products match.</p>
          ) : products.map(p => (
            <label key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50/50">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-green-600" />
              <span className="text-xs text-gray-400 w-28 shrink-0 truncate tabular-nums">{p.code ?? '—'}</span>
              <span className="flex-1 text-gray-800 truncate">{p.name}</span>
              {p.pending && <span className="text-[10px] bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 shrink-0">pending</span>}
              <span className={`text-[10px] rounded-full px-2 py-0.5 shrink-0 ${p.status === 'flagged' ? 'bg-red-50 text-red-600' : p.status === 'no-photo' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-600'}`}>
                {p.status === 'flagged' ? 'bad photo' : p.status === 'no-photo' ? 'no photo' : 'has photo'}
              </span>
            </label>
          ))}
        </div>
        {truncated && <p className="text-xs text-gray-400 mt-1">Showing first 60 — refine the search to see more.</p>}
      </div>

      {/* Step 3 — run */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void run()}
          disabled={!canRun}
          className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
        >
          {phase === 'running' ? `Searching… ${done}/${selected.size}` : `Search ${selected.size || ''} on ${domain || 'website'}`.trim()}
        </button>
        {phase === 'running' && <button onClick={() => { cancelRef.current = true }} className="px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Stop</button>}
        {!canRun && phase !== 'running' && <span className="text-xs text-gray-400">{!domain.includes('.') ? 'Enter a website' : 'Select at least one product'}</span>}
      </div>

      {/* Progress + results */}
      {phase !== 'idle' && (
        <div className="space-y-2">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${selected.size ? (done / selected.size) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>✓ {matched.length} matched on {domain}</span>
            <span>✗ {notFound.length} not found</span>
            {phase === 'done' && <span className="text-green-700 font-medium ml-auto">Done — approve in Photo Review →</span>}
          </div>
        </div>
      )}

      {matched.length > 0 && (
        <ResultGroup title={`✓ Matched on ${domain}`} hint="Downloaded and queued for review. 🟢 exact = code matched · 🟡 similar = name matched, verify variant." rows={matched} />
      )}
      {notFound.length > 0 && (
        <ResultGroup title="✗ Not found on this site" hint="No photo for these on the given website — try another site, or handle manually in Photo Review." rows={notFound} muted />
      )}
    </div>
  )
}

function ResultGroup({ title, hint, rows, muted }: { title: string; hint: string; rows: Result[]; muted?: boolean }) {
  return (
    <section className={`bg-white rounded-xl border ${muted ? 'border-gray-200' : 'border-green-200'} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title} <span className="text-gray-400 font-normal">({rows.length})</span></h3>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>
      <div className="divide-y divide-gray-50">
        {rows.map(r => (
          <div key={r.productId} className="flex items-center gap-3 px-5 py-2.5">
            {r.photoUrl
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={r.photoUrl} alt="" className="w-12 h-12 object-contain rounded bg-white border border-gray-100 shrink-0" />
              : <div className="w-12 h-12 rounded bg-gray-100 shrink-0 flex items-center justify-center text-gray-300 text-[10px]">none</div>}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 truncate">{r.tier === 'exact' ? '🟢 ' : r.tier === 'similar' ? '🟡 ' : ''}{r.name}</p>
              <p className="text-xs text-gray-400">{r.code ?? '—'}{r.reason ? ` · ${r.reason}` : ''}</p>
            </div>
            {r.flagged && <span className="text-[10px] bg-red-50 text-red-600 rounded-full px-2 py-0.5 shrink-0">AI flagged</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
