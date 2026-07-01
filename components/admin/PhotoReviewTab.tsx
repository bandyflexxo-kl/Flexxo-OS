'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useBackgroundTasks } from '@/context/BackgroundTasksContext'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PhotoProduct = {
  id:                   string
  name:                 string
  brand:                string | null
  qneItemCode:          string | null
  photoUrl:             string
  photoQualityFlagged:  boolean | null
  photoQualityNote:     string | null
  photoApprovedByAdmin: boolean
  photoApprovalPending: boolean
  category:             { name: string; parentCategory: { name: string } | null }
}

type ApiData = {
  total:                number
  flaggedTotal:         number
  unscannedTotal:       number
  pendingApprovalTotal: number
  page:                 number
  pageSize:             number
  products:             PhotoProduct[]
}

type Filter    = 'all' | 'flagged' | 'clean' | 'unscanned' | 'pending'
type ResolveMethod = 'A' | 'B' | 'C' | 'D'

type ResolvePhase =
  | { kind: 'selecting'; method: ResolveMethod | null; file: File | null; previewUrl: string | null }
  | { kind: 'applying' }
  | { kind: 'scanning' }
  | { kind: 'result';    flagged: boolean; reason: string; newPhotoUrl: string }

type ScanAllPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'running';   total: number; done: number; flagged: number; clean: number; errors: number }
  | { kind: 'done';      total: number; flagged: number; clean: number; errors: number }

// ─────────────────────────────────────────────────────────────────────────────
// Scan All Modal
// ─────────────────────────────────────────────────────────────────────────────

function ScanAllModal({ onClose }: { onClose: () => void }) {
  const [phase,     setPhase]    = useState<ScanAllPhase>({ kind: 'idle' })
  const [log,       setLog]      = useState<{ name: string; flagged: boolean; error?: string }[]>([])
  const cancelRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  async function start() {
    cancelRef.current = false
    setLog([])
    setPhase({ kind: 'loading' })

    const idsRes  = await fetch('/api/admin/products/photo-review/scan-ids')
    const idsData = await idsRes.json() as { ids: string[]; total: number }
    const allIds  = idsData.ids

    if (allIds.length === 0) {
      setPhase({ kind: 'done', total: 0, flagged: 0, clean: 0, errors: 0 })
      return
    }

    const BATCH  = 10
    let done     = 0
    let flagged  = 0
    let clean    = 0
    let errors   = 0
    const total  = allIds.length

    setPhase({ kind: 'running', total, done: 0, flagged: 0, clean: 0, errors: 0 })

    for (let i = 0; i < allIds.length; i += BATCH) {
      if (cancelRef.current) break

      const batch  = allIds.slice(i, i + BATCH)
      const res    = await fetch('/api/admin/products/photo-review/scan-batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: batch }),
      })
      const data = await res.json() as { results: { id: string; name: string; flagged: boolean; reason: string; error?: string }[] }

      for (const r of data.results) {
        done++
        if (r.error)        errors++
        else if (r.flagged) flagged++
        else                clean++
        setLog(prev => [...prev.slice(-99), { name: r.name, flagged: r.flagged, error: r.error }])
      }
      setPhase({ kind: 'running', total, done, flagged, clean, errors })
    }

    setPhase({ kind: 'done', total: done, flagged, clean, errors })
  }

  useEffect(() => { void start() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = phase.kind === 'running' && phase.total > 0
    ? Math.round((phase.done / phase.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Scan All Photos</h2>
            <p className="text-xs text-gray-400 mt-0.5">Claude Haiku · ~1 credit per photo</p>
          </div>
          {(phase.kind === 'done' || phase.kind === 'idle') && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>

        {/* Progress */}
        <div className="px-6 py-4 space-y-3">
          {phase.kind === 'loading' && (
            <p className="text-sm text-gray-500 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              Loading unscanned photos…
            </p>
          )}

          {(phase.kind === 'running' || phase.kind === 'done') && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900">
                  {phase.kind === 'done' ? 'Complete' : `Scanning… ${phase.done} / ${phase.total}`}
                </span>
                <span className="text-gray-400">{pct > 0 ? `${pct}%` : ''}</span>
              </div>
              {phase.kind === 'running' && (
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              <div className="flex gap-4 text-xs">
                <span className="text-red-600 font-medium">🔴 {phase.flagged} flagged</span>
                <span className="text-green-600 font-medium">✓ {phase.clean} clean</span>
                {phase.errors > 0 && <span className="text-gray-400">⚠ {phase.errors} errors</span>}
              </div>
            </>
          )}
        </div>

        {/* Live log */}
        {log.length > 0 && (
          <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
            <div className="space-y-0.5">
              {log.map((entry, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs py-0.5 ${entry.error ? 'text-gray-400' : ''}`}>
                  <span className="shrink-0">
                    {entry.error ? '⚠' : entry.flagged ? '🔴' : '✓'}
                  </span>
                  <span className="truncate text-gray-700">{entry.name}</span>
                  {entry.error && <span className="text-gray-400 shrink-0">error</span>}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          {phase.kind === 'running' ? (
            <>
              <button
                onClick={() => { cancelRef.current = true }}
                className="text-sm text-gray-500 hover:text-red-600 transition-colors"
              >
                Cancel
              </button>
              <p className="text-xs text-gray-400">Safe to leave — progress saved to DB</p>
            </>
          ) : phase.kind === 'done' ? (
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Done — Refresh list
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve Panel (inline, per flagged row)
// ─────────────────────────────────────────────────────────────────────────────

function ResolvePanel({
  product,
  onDone,
  onClose,
  onEnlarge,
}: {
  product:   PhotoProduct
  onDone:    (newPhotoUrl: string | null) => void
  onClose:   () => void
  onEnlarge: (url: string) => void
}) {
  const { runTask, role } = useBackgroundTasks()
  const isApprover = role === 'Director' || role === 'Manager'
  const [phase, setPhase] = useState<ResolvePhase>({
    kind: 'selecting', method: null, file: null, previewUrl: null,
  })
  const [error,         setError]         = useState<string | null>(null)
  const [overrideSite,  setOverrideSite]  = useState('')
  const [searchHint,    setSearchHint]    = useState('')
  const [rememberBrand, setRememberBrand] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function selectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (!f) return
    const url = URL.createObjectURL(f)
    setPhase({ kind: 'selecting', method: 'A', file: f, previewUrl: url })
  }

  async function submit() {
    if (phase.kind !== 'selecting' || !phase.method) return
    setError(null)

    // ── Method A: manual file upload (synchronous — fast, user stays to confirm) ──
    if (phase.method === 'A') {
      if (!phase.file) { setError('Please choose a file first'); return }
      setPhase({ kind: 'applying' })
      try {
        const form = new FormData()
        form.append('file', phase.file)
        const res  = await fetch(`/api/admin/products/${product.id}/photo`, { method: 'POST', body: form })
        const json = await res.json() as { photoUrl?: string; flagged?: boolean; reason?: string; error?: string }
        if (!res.ok) { setError(json.error ?? 'Upload failed'); setPhase({ kind: 'selecting', method: 'A', file: phase.file, previewUrl: phase.previewUrl }); return }
        setPhase({ kind: 'result', flagged: json.flagged!, reason: json.reason!, newPhotoUrl: json.photoUrl! })
      } catch { setError('Upload failed'); setPhase({ kind: 'selecting', method: 'A', file: phase.file, previewUrl: phase.previewUrl }) }
      return
    }

    // ── Methods B, C, D: fire in background — panel closes immediately ───────
    // These run as background tasks so admin can continue reviewing other items.
    // Results appear in the BottomTasksPanel widget (bottom-right corner).
    const shortName = product.name.length > 32 ? `${product.name.slice(0, 32)}…` : product.name

    if (phase.method === 'D') {
      if (isApprover) {
        // Director/Manager: approve directly
        runTask({
          label:     `Approve: ${shortName}`,
          productId: product.id,
          execute:   async () => {
            const res  = await fetch(`/api/admin/products/${product.id}/approve-photo`, { method: 'POST' })
            const json = await res.json() as { error?: string }
            if (!res.ok) throw new Error(json.error ?? 'Approve failed')
            return { type: 'done' as const, message: 'Marked clean ✓', flagged: false }
          },
        })
      } else {
        // Admin: request Director approval
        runTask({
          label:     `Request approval: ${shortName}`,
          productId: product.id,
          execute:   async () => {
            const res  = await fetch(`/api/admin/products/${product.id}/request-photo-approval`, { method: 'POST' })
            const json = await res.json() as { error?: string }
            if (!res.ok) throw new Error(json.error ?? 'Request failed')
            return { type: 'done' as const, message: 'Sent to Director for approval ✓', flagged: false }
          },
        })
      }
      onClose()
      return
    }

    if (phase.method === 'B' || phase.method === 'C') {
      const methodLabel = phase.method === 'B' ? 'Re-scrape' : 'AI search'
      const endpoint    = phase.method === 'B'
        ? `/api/admin/products/${product.id}/rescrape`
        : `/api/admin/products/${product.id}/websearch`

      const site = overrideSite.trim() || undefined
      const hint = searchHint.trim()   || undefined

      // Persist brand override if checkbox ticked
      if (rememberBrand && product.brand && (site || hint)) {
        void fetch('/api/admin/brand-sites', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ brand: product.brand, site: site ?? null, hint: hint ?? null }),
        })
      }

      runTask({
        label:        `${methodLabel}: ${shortName}`,
        subLabel:     'Searching official brand site…',
        productId:    product.id,
        endpoint,
        searchParams: { site, hint },
        execute:      async () => {
          const r1 = await fetch(endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ site, hint }),
          })
          // Read defensively — a timed-out/crashed function returns an empty body,
          // and a blind r1.json() would throw "Unexpected end of JSON input".
          const raw = await r1.text()
          let d1: { candidates?: { imageUrl: string; title: string }[]; error?: string } = {}
          try { d1 = raw ? JSON.parse(raw) : {} } catch { /* empty/non-JSON body */ }
          if (!r1.ok || !d1.candidates?.length) {
            throw new Error(d1.error ?? (raw === '' ? 'The image search took too long and timed out — please try again.' : 'No results found on official brand site'))
          }
          return { type: 'candidates' as const, candidates: d1.candidates }
        },
      })
      onClose()
      return
    }
  }


  const brandSiteLabel = product.brand ?? 'brand'
  const methodLabel    = {
    A: 'Upload File',
    B: 'Re-scrape (Official Site)',
    C: 'AI Web Search (Official Site)',
    D: isApprover ? 'Approve as Clean' : 'Request Director Approval',
  }
  const methodDesc     = {
    A: 'Pick a clean photo from your computer (stays here until done)',
    B: `Searches ${brandSiteLabel}'s site — you pick from results in the bottom widget`,
    C: `Claude AI crafts query, searches ${brandSiteLabel}'s site — you pick from results`,
    D: isApprover
      ? 'Marks this photo permanently acceptable — AI scan will be skipped forever'
      : 'Sends a request to the Director to permanently approve this photo',
  }
  const isSearchMethod = phase.kind === 'selecting' && (phase.method === 'B' || phase.method === 'C')

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-4">
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex gap-4">
        {/* Current photo */}
        <div className="shrink-0">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Current (flagged)</p>
          <button
            type="button"
            onClick={() => onEnlarge(product.photoUrl)}
            title="Click to enlarge"
            className="relative w-24 h-24 rounded-lg overflow-hidden bg-white border-2 border-red-300 block cursor-zoom-in hover:border-red-500 transition-colors"
          >
            <Image src={product.photoUrl} alt={product.name} fill sizes="96px" className="object-contain p-1" unoptimized />
            <div className="absolute bottom-1 right-1 bg-black/40 rounded p-0.5">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"/>
              </svg>
            </div>
          </button>
          {product.photoQualityNote && (
            <p className="text-xs text-red-600 mt-1 max-w-[96px] leading-tight">{product.photoQualityNote}</p>
          )}
        </div>

        {/* Right panel — changes by phase */}
        <div className="flex-1 min-w-0">

          {/* Phase: selecting */}
          {phase.kind === 'selecting' && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700 mb-2">Choose replacement method:</p>
              {(['A', 'B', 'C'] as Array<'A'|'B'|'C'>).map(m => (
                <label key={m} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${phase.method === m ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name={`method-${product.id}`}
                    value={m}
                    checked={phase.method === m}
                    onChange={() => setPhase({ kind: 'selecting', method: m, file: null, previewUrl: null })}
                    className="mt-0.5 accent-green-600"
                  />
                  <div className="min-w-0 w-full">
                    <p className="text-xs font-semibold text-gray-800">{m}. {methodLabel[m]}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{methodDesc[m]}</p>
                    {m === 'A' && phase.method === 'A' && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                        >
                          {phase.file ? 'Change file' : 'Choose file…'}
                        </button>
                        {phase.file && (
                          <span className="text-xs text-gray-500 truncate max-w-[120px]">{phase.file.name}</span>
                        )}
                        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={selectFile} />
                      </div>
                    )}
                  </div>
                </label>
              ))}

              {/* Search instruction fields — visible when B or C is selected */}
              {isSearchMethod && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-blue-800">Search instructions (optional)</p>
                  <div>
                    <label className="text-[11px] text-blue-700 block mb-1">Override website</label>
                    <input
                      type="text"
                      value={overrideSite}
                      onChange={e => setOverrideSite(e.target.value)}
                      placeholder={`e.g. everlas.com`}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-blue-700 block mb-1">Search hint</label>
                    <input
                      type="text"
                      value={searchHint}
                      onChange={e => setSearchHint(e.target.value)}
                      placeholder="e.g. heavy duty double sided ladder"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  {product.brand && (overrideSite.trim() || searchHint.trim()) && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberBrand}
                        onChange={e => setRememberBrand(e.target.checked)}
                        className="accent-blue-600 w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-blue-700">
                        Remember this for all <strong className="text-blue-900">{product.brand}</strong> products
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Option D — manual approve */}
              <div className="border-t border-dashed border-gray-200 pt-2">
                <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${phase.method === 'D' ? 'border-blue-500 bg-blue-50' : 'border-dashed border-gray-300 bg-white hover:border-gray-400'}`}>
                  <input
                    type="radio"
                    name={`method-${product.id}`}
                    value="D"
                    checked={phase.method === 'D'}
                    onChange={() => setPhase({ kind: 'selecting', method: 'D', file: null, previewUrl: null })}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="text-xs font-semibold text-gray-800">D. {methodLabel['D']}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{methodDesc['D']}</p>
                  </div>
                </label>
              </div>

              {/* Preview for method A */}
              {phase.method === 'A' && phase.previewUrl && (
                <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-white mt-1">
                  <Image src={phase.previewUrl} alt="Preview" fill sizes="80px" className="object-contain p-1" unoptimized />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void submit()}
                  disabled={!phase.method || (phase.method === 'A' && !phase.file)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Submit →
                </button>
                <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-200 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}


          {/* Phase: applying */}
          {phase.kind === 'applying' && (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              Uploading + scanning with AI…
            </div>
          )}

          {/* Phase: result */}
          {phase.kind === 'result' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {/* New photo preview */}
                <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-white shrink-0">
                  <Image src={phase.newPhotoUrl} alt="New photo" fill sizes="80px" className="object-contain p-1" unoptimized />
                </div>
                <div>
                  {phase.flagged ? (
                    <>
                      <p className="text-sm font-semibold text-red-600">Still flagged 🔴</p>
                      <p className="text-xs text-red-500 mt-0.5">{phase.reason}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-green-700">Clean ✓</p>
                      <p className="text-xs text-green-600 mt-0.5">Photo replaced successfully</p>
                    </>
                  )}
                </div>
              </div>

              {phase.flagged && (
                <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
                  New photo is still flagged. You can try another method, remove the new photo, or
                  {isApprover ? ' approve it anyway.' : ' request the Director to approve it.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {phase.flagged ? (
                  <>
                    <button
                      onClick={() => setPhase({ kind: 'selecting', method: null, file: null, previewUrl: null })}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                    >
                      Try Another Method
                    </button>
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/admin/products/${product.id}/photo`, { method: 'DELETE' })
                        if (res.ok) onDone(null)
                        else setError('Failed to remove photo')
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                    >
                      Remove new photo
                    </button>
                    {isApprover ? (
                      <button
                        onClick={async () => {
                          const res  = await fetch(`/api/admin/products/${product.id}/approve-photo`, { method: 'POST' })
                          const json = await res.json() as { error?: string }
                          if (res.ok) onDone(null)
                          else setError(json.error ?? 'Approval failed')
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Approve anyway
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          const res  = await fetch(`/api/admin/products/${product.id}/request-photo-approval`, { method: 'POST' })
                          const json = await res.json() as { error?: string }
                          if (res.ok) onDone(null)
                          else setError(json.error ?? 'Request failed')
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors"
                      >
                        Request Director approval
                      </button>
                    )}
                    <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-200 transition-colors">
                      Leave as Flagged
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onDone(phase.newPhotoUrl)}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors"
                  >
                    Done ✓
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────

export default function PhotoReviewTab() {
  const [data,           setData]           = useState<ApiData | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [filter,         setFilter]         = useState<Filter>('all')
  const [search,         setSearch]         = useState('')
  const [debouncedSearch,setDebouncedSearch]= useState('')
  const [page,           setPage]           = useState(0)
  const [busyIds,        setBusyIds]        = useState<Set<string>>(new Set())
  const [confirmDelete,  setConfirmDelete]  = useState<string | null>(null)
  const [resolveId,      setResolveId]      = useState<string | null>(null)
  const [showScanAll,    setShowScanAll]    = useState(false)
  const [lightboxUrl,    setLightboxUrl]    = useState<string | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { tasks, role } = useBackgroundTasks()
  const isApprover = role === 'Director' || role === 'Manager'

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 350)
  }, [search])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/products/photo-review?page=${page}&filter=${filter}&search=${encodeURIComponent(debouncedSearch)}`)
      const json = await res.json() as ApiData
      setData(json)
    } catch { setError('Failed to load photos') }
    finally  { setLoading(false) }
  }, [page, filter, debouncedSearch])

  useEffect(() => { void fetchData() }, [fetchData])

  // Reload when a background task (in BottomTasksPanel) completes
  useEffect(() => {
    const handler = () => void fetchData()
    window.addEventListener('photo-review-refresh', handler)
    return () => window.removeEventListener('photo-review-refresh', handler)
  }, [fetchData])

  function changeFilter(f: Filter) { setFilter(f); setPage(0); setResolveId(null) }

  // ── Scan single ──────────────────────────────────────────────────────────
  async function scanOne(id: string) {
    setBusyIds(prev => new Set([...prev, id]))
    try {
      const res  = await fetch(`/api/admin/products/${id}/scan-quality`, { method: 'POST' })
      const json = await res.json() as { flagged: boolean; reason: string; error?: string }
      if (!res.ok) { setError(json.error ?? 'Scan failed'); return }
      setData(prev => prev ? {
        ...prev,
        products: prev.products.map(p =>
          p.id === id ? { ...p, photoQualityFlagged: json.flagged, photoQualityNote: json.reason } : p
        ),
      } : null)
    } catch { setError('Scan failed — check Anthropic API key') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Scan page ────────────────────────────────────────────────────────────
  async function scanPage() {
    if (!data) return
    const unscanned = data.products.filter(p => p.photoQualityFlagged === null)
    if (!unscanned.length) { setError('All photos on this page already scanned.'); return }
    for (const p of unscanned) await scanOne(p.id)
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function deletePhoto(id: string) {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setConfirmDelete(null)
    setBusyIds(prev => new Set([...prev, id]))
    try {
      const res = await fetch(`/api/admin/products/${id}/photo`, { method: 'DELETE' })
      if (!res.ok) { setError('Delete failed'); return }
      setData(prev => prev ? { ...prev, total: prev.total - 1, products: prev.products.filter(p => p.id !== id) } : null)
      if (resolveId === id) setResolveId(null)
    } catch { setError('Delete failed') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Force clean / Request approval — role-aware ──────────────────────────
  async function forceCleanOne(id: string) {
    setBusyIds(prev => new Set([...prev, id]))
    try {
      if (isApprover) {
        // Director/Manager: approve directly and lock permanently
        const res = await fetch(`/api/admin/products/${id}/approve-photo`, { method: 'POST' })
        if (!res.ok) { setError('Approval failed'); return }
        setData(prev => prev ? {
          ...prev,
          products: prev.products.map(p =>
            p.id === id
              ? { ...p, photoQualityFlagged: false, photoApprovedByAdmin: true,
                  photoApprovalPending: false,
                  photoQualityNote: 'Permanently approved — AI scan skipped' }
              : p
          ),
        } : null)
        if (resolveId === id) setResolveId(null)
      } else {
        // Admin: request Director approval
        const res = await fetch(`/api/admin/products/${id}/request-photo-approval`, { method: 'POST' })
        if (!res.ok) { setError('Request failed'); return }
        setData(prev => prev ? {
          ...prev,
          products: prev.products.map(p =>
            p.id === id ? { ...p, photoApprovalPending: true } : p
          ),
        } : null)
        if (resolveId === id) setResolveId(null)
      }
    } catch { setError(isApprover ? 'Approval failed' : 'Request failed') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Manually flag a clean/locked photo (mis-clean or AI miss) ─────────────
  async function flagOne(id: string) {
    setBusyIds(prev => new Set([...prev, id]))
    try {
      const res = await fetch(`/api/admin/products/${id}/flag-photo`, { method: 'POST' })
      if (!res.ok) { setError('Could not flag this photo.'); return }
      setData(prev => prev ? {
        ...prev,
        products: prev.products.map(p =>
          p.id === id
            ? { ...p, photoQualityFlagged: true, photoApprovedByAdmin: false,
                photoApprovalPending: false, photoQualityNote: 'Manually flagged' }
            : p
        ),
      } : null)
    } catch { setError('Could not flag this photo.') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Approve pending (Director only) ──────────────────────────────────────
  async function approveOne(id: string) {
    setBusyIds(prev => new Set([...prev, id]))
    try {
      const res = await fetch(`/api/admin/products/${id}/approve-photo`, { method: 'POST' })
      if (!res.ok) { setError('Approval failed'); return }
      setData(prev => prev ? {
        ...prev,
        products: prev.products.map(p =>
          p.id === id
            ? { ...p, photoQualityFlagged: false, photoApprovedByAdmin: true,
                photoApprovalPending: false,
                photoQualityNote: 'Permanently approved — AI scan skipped' }
            : p
        ),
      } : null)
    } catch { setError('Approval failed') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Reject pending approval (Director only) ───────────────────────────────
  async function rejectApprovalOne(id: string) {
    setBusyIds(prev => new Set([...prev, id]))
    try {
      const res = await fetch(`/api/admin/products/${id}/request-photo-approval`, { method: 'DELETE' })
      if (!res.ok) { setError('Reject failed'); return }
      setData(prev => prev ? {
        ...prev,
        products: prev.products.map(p =>
          p.id === id ? { ...p, photoApprovalPending: false } : p
        ),
      } : null)
    } catch { setError('Reject failed') }
    finally   { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  // ── Resolve done (photo replaced + clean) ────────────────────────────────
  function handleResolveDone(productId: string, newPhotoUrl: string | null) {
    setResolveId(null)
    if (newPhotoUrl) {
      setData(prev => prev ? {
        ...prev,
        products: prev.products.map(p =>
          p.id === productId
            ? { ...p, photoUrl: newPhotoUrl, photoQualityFlagged: false, photoQualityNote: 'Replaced — clean' }
            : p
        ),
      } : null)
    } else {
      void fetchData()
    }
  }

  const totalPages = data ? Math.ceil(
    (filter === 'all'        ? data.total
     : filter === 'flagged'  ? data.flaggedTotal
     : filter === 'unscanned'? data.unscannedTotal
     : filter === 'pending'  ? data.pendingApprovalTotal
     : Math.max(0, data.total - data.flaggedTotal - data.unscannedTotal)
    ) / data.pageSize
  ) : 1

  return (
    <div className="space-y-4">

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Product photo enlarged"
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            style={{ maxWidth: '80vw', maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/30 hover:bg-black/60 rounded-full p-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {showScanAll && (
        <ScanAllModal onClose={() => { setShowScanAll(false); void fetchData() }} />
      )}

      {/* Stats */}
      {data && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{data.total.toLocaleString()} scraped photos</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
            {data.flaggedTotal} flagged
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
            {data.unscannedTotal} unscanned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            {data.total - data.flaggedTotal - data.unscannedTotal} clean
          </span>
          {data.pendingApprovalTotal > 0 && (
            <span className="flex items-center gap-1.5 text-amber-700">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              {data.pendingApprovalTotal} pending approval
            </span>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['all', 'flagged', 'clean', 'unscanned'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`px-3 py-1.5 font-medium transition-colors ${filter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {f === 'all' ? 'All' : f === 'flagged' ? '🔴 Flagged' : f === 'clean' ? '✓ Clean' : '⬜ Unscanned'}
            </button>
          ))}
        </div>
        {/* Pending filter — always shown; Directors act on it, Admin sees requests they sent */}
        <button
          onClick={() => changeFilter('pending')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            filter === 'pending'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
          }`}
        >
          ⏳ Pending Approval
          {data && data.pendingApprovalTotal > 0 && (
            <span className={`text-xs rounded-full px-1.5 py-0.5 font-semibold ${filter === 'pending' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {data.pendingApprovalTotal}
            </span>
          )}
        </button>

        <input
          type="search"
          placeholder="Search name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-green-500"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void scanPage()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Scan Page
          </button>
          <button
            onClick={() => setShowScanAll(true)}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
            Scan All
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          Loading photos…
        </div>
      )}

      {!loading && data && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {data.products.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No photos found</div>
          ) : (
            data.products.map(p => {
              const busy        = busyIds.has(p.id)
              const catName     = p.category.parentCategory?.name ?? p.category.name
              const isResolving = resolveId === p.id
              const activeTask  = tasks.find(t => t.productId === p.id &&
                (t.status === 'running' || t.status === 'applying' ||
                 t.status === 'error'   || t.status === 'candidates'))
              const isTaskBusy  = !!activeTask &&
                (activeTask.status === 'running' || activeTask.status === 'applying')

              return (
                <div key={p.id}>
                  {/* Row */}
                  <div className={`flex items-center gap-4 px-4 py-3 transition-colors ${isResolving ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                    {/* Thumbnail — click to enlarge */}
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(p.photoUrl)}
                      className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 cursor-zoom-in group"
                    >
                      <Image
                        src={p.photoUrl}
                        alt={p.name}
                        fill
                        sizes="80px"
                        className="object-contain p-1"
                        unoptimized
                      />
                      {p.photoQualityFlagged === true && (
                        <div className="absolute inset-0 border-2 border-red-400 rounded-lg pointer-events-none" />
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0zm0 0l.01.01M11 8v6m-3-3h6"/>
                        </svg>
                      </div>
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {p.qneItemCode && <span className="font-mono">{p.qneItemCode} · </span>}
                        {catName}
                        {p.brand && <span className="text-gray-500"> · {p.brand}</span>}
                      </p>
                      {p.photoQualityNote && (
                        <p className={`text-xs mt-0.5 ${p.photoQualityFlagged ? 'text-red-600' : 'text-green-700'}`}>
                          {p.photoQualityNote}
                        </p>
                      )}
                    </div>

                    {/* AI badge */}
                    <div className="shrink-0 w-32 text-center">
                      {p.photoApprovedByAdmin ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5" title="Permanently approved — AI scan skipped">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                          </svg>
                          Locked
                        </span>
                      ) : p.photoApprovalPending ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5" title="Pending Director approval">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                          Pending Approval
                        </span>
                      ) : p.photoQualityFlagged === null ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />Unscanned
                        </span>
                      ) : p.photoQualityFlagged ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Flagged
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Clean
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {/* Resolve button — only for flagged */}
                      {p.photoQualityFlagged === true && (
                        <button
                          disabled={isTaskBusy}
                          onClick={() => { if (isTaskBusy) return; setResolveId(isResolving ? null : p.id); setConfirmDelete(null) }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isResolving ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                        >
                          {isResolving ? 'Collapse ▲' : 'Resolve ▼'}
                        </button>
                      )}

                      {/* Director approve/reject for pending rows */}
                      {p.photoApprovalPending && isApprover && (
                        <>
                          <button
                            onClick={() => void approveOne(p.id)}
                            disabled={busy}
                            title="Approve — permanently lock this photo"
                            className="px-2 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => void rejectApprovalOne(p.id)}
                            disabled={busy}
                            title="Reject — keep photo as flagged"
                            className="px-2 py-1 rounded-lg text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {/* Force clean / Request approval — visible for flagged or scanned-but-not-yet-locked */}
                      {!p.photoApprovedByAdmin && !p.photoApprovalPending && p.photoQualityFlagged !== null && (
                        <button
                          onClick={() => void forceCleanOne(p.id)}
                          disabled={busy || isTaskBusy}
                          title={isApprover
                            ? 'Permanently approve — AI will never re-flag this product'
                            : 'Request Director to permanently approve this photo'}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
                          </svg>
                        </button>
                      )}

                      {/* Manual flag — for clean or locked photos a reviewer knows are wrong */}
                      {(p.photoQualityFlagged === false || p.photoApprovedByAdmin) && !p.photoApprovalPending && (
                        <button
                          onClick={() => void flagOne(p.id)}
                          disabled={busy || isTaskBusy}
                          title="Flag this photo as unacceptable — re-opens it for review"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"/>
                          </svg>
                        </button>
                      )}

                      {/* Scan */}
                      <button
                        onClick={() => void scanOne(p.id)}
                        disabled={busy || isTaskBusy}
                        title="Scan with AI"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 disabled:opacity-40 transition-colors"
                      >
                        {busy && !confirmDelete ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                          </svg>
                        )}
                      </button>

                      {/* Delete */}
                      {confirmDelete === p.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void deletePhoto(p.id)}
                            disabled={busy}
                            className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            Confirm
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => void deletePhoto(p.id)}
                          disabled={busy}
                          title="Delete photo"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline task progress strip — visible when a background task is active for this product */}
                  {activeTask && (
                    <div className={`px-4 py-2.5 border-t ${
                      activeTask.status === 'error'      ? 'bg-red-50 border-red-100' :
                      activeTask.status === 'candidates' ? 'bg-amber-50 border-amber-100' :
                                                           'bg-blue-50 border-blue-100'
                    }`}>
                      {(activeTask.status === 'running' || activeTask.status === 'applying') && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                            </svg>
                            <span className="text-xs font-semibold text-blue-700 truncate">{activeTask.label}</span>
                            {activeTask.subLabel && (
                              <span className="text-xs text-blue-500 truncate shrink-0">· {activeTask.subLabel}</span>
                            )}
                          </div>
                          <div className="h-1 bg-blue-100 rounded-full overflow-hidden">
                            <div className="h-full w-1/2 bg-blue-500 rounded-full animate-pulse" />
                          </div>
                        </div>
                      )}
                      {activeTask.status === 'candidates' && (
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500 text-sm shrink-0">◉</span>
                          <span className="text-xs font-semibold text-amber-800">
                            {activeTask.candidates?.length ?? 0} candidates ready
                          </span>
                          <span className="text-xs text-amber-600">— pick a photo in the bottom-right panel</span>
                        </div>
                      )}
                      {activeTask.status === 'error' && (
                        <div className="flex items-start gap-2">
                          <span className="text-red-500 text-sm shrink-0">✗</span>
                          <span className="text-xs text-red-700 break-words">{activeTask.message}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline resolve panel */}
                  {isResolving && (
                    <ResolvePanel
                      product={p}
                      onDone={(newUrl) => handleResolveDone(p.id, newUrl)}
                      onClose={() => setResolveId(null)}
                      onEnlarge={setLightboxUrl}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span>Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
