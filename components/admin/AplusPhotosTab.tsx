'use client'

/**
 * APLUS Photos tab (/admin/products?tab=aplus-photos) — hunts product photos
 * for unmatched/flagged APLUS items on STP (the APLUS retailer) first, then
 * other MY retailers. Found photos are AI-quality-scanned and queued for review;
 * nothing goes live to the shop without a ✔ in the Photo Review tab.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Target = { id: string; name: string; code: string | null; reason: 'no-photo' | 'flagged'; pending: boolean }
type ApiData = { total: number; noPhoto: number; flagged: number; targets: Target[] }
type Tier = 'exact' | 'similar' | 'none'
type Result = {
  productId: string; name: string; code: string | null; tier: Tier
  source?: string | null; photoUrl?: string | null; flagged?: boolean; reason?: string
}

const CONCURRENCY = 2

export default function AplusPhotosTab() {
  const [data, setData]       = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [phase, setPhase]     = useState<'idle' | 'running' | 'done'>('idle')
  const [done, setDone]       = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const cancelRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/admin/products/aplus-photo-hunt')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json() as ApiData)
    } catch { setError('Could not load APLUS targets.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function run() {
    if (!data) return
    cancelRef.current = false
    setPhase('running'); setResults([]); setDone(0)
    const ids = data.targets.map(t => t.id)
    let i = 0
    const worker = async () => {
      while (i < ids.length && !cancelRef.current) {
        const id = ids[i++]
        try {
          const r = await fetch('/api/admin/products/aplus-photo-hunt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: id }),
          })
          const res = await r.json() as Result & { error?: string }
          if (!res.error) setResults(prev => [...prev, res])
        } catch { /* skip one failure, keep going */ }
        finally { setDone(d => d + 1) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    setPhase('done')
    void load()   // refresh counts + pending flags
  }

  if (loading && !data) return <p className="text-sm text-gray-400 py-10 text-center">Loading APLUS targets…</p>
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
      {error} <button onClick={() => void load()} className="underline font-medium ml-1">Retry</button>
    </div>
  )
  if (!data) return null

  const exact   = results.filter(r => r.tier === 'exact')
  const similar = results.filter(r => r.tier === 'similar')
  const none    = results.filter(r => r.tier === 'none')

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3.5 text-sm text-green-900 space-y-1">
        <p className="font-semibold">How this works</p>
        <p className="text-green-800">
          Searches <span className="font-medium">stpstationery.com.my</span> (the APLUS retailer) first, then other Malaysian
          stationery retailers, for each APLUS product below. Every photo it finds is AI quality-checked and placed in the{' '}
          <a href="/admin/products?tab=photos" className="underline font-medium">Photo Review</a> pending queue —
          <span className="font-medium"> nothing goes live to the shop until you approve it.</span>
        </p>
      </div>

      {/* Summary + run button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-4 flex-1 min-w-[280px]">
          <Stat label="Targets" value={data.total} />
          <Stat label="No photo" value={data.noPhoto} />
          <Stat label="Bad photo (flagged)" value={data.flagged} color="text-red-600" />
        </div>
        <div className="flex items-center gap-3">
          {phase === 'running' && (
            <button onClick={() => { cancelRef.current = true }} className="px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Stop</button>
          )}
          <button
            onClick={() => void run()}
            disabled={phase === 'running' || data.total === 0}
            className="px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
          >
            {phase === 'running' ? `Searching… ${done}/${data.total}` : `⟳ Find APLUS photos (${data.total})`}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {phase !== 'idle' && (
        <div className="space-y-2">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${data.total ? (done / data.total) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>🟢 {exact.length} exact</span>
            <span>🟡 {similar.length} verify</span>
            <span>🔴 {none.length} not found</span>
            {phase === 'done' && <span className="text-green-700 font-medium ml-auto">Done — approve in Photo Review →</span>}
          </div>
        </div>
      )}

      {/* Results */}
      {exact.length > 0 && (
        <ResultGroup
          title="🟢 Exact match — safe, just confirm" tone="green"
          hint="The product's model code was found in the image source. Approve these in Photo Review."
          rows={exact}
        />
      )}
      {similar.length > 0 && (
        <ResultGroup
          title="🟡 Similar — check the variant" tone="amber"
          hint="Matched by name, not code. Verify it's the right colour / pack size before approving."
          rows={similar}
        />
      )}
      {none.length > 0 && (
        <ResultGroup
          title="🔴 Not found — handle manually" tone="red"
          hint="No confident match. Use per-product AI search in the Photo Review tab, or upload a photo."
          rows={none}
        />
      )}

      {/* Idle target preview */}
      {phase === 'idle' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">Targets ({data.total})</div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {data.targets.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="text-xs text-gray-400 w-24 shrink-0 tabular-nums">{t.code ?? '—'}</span>
                <span className="flex-1 text-gray-800 truncate">{t.name}</span>
                {t.pending && <span className="text-[10px] bg-blue-50 text-blue-600 rounded-full px-2 py-0.5">already pending</span>}
                <span className={`text-[10px] rounded-full px-2 py-0.5 ${t.reason === 'flagged' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                  {t.reason === 'flagged' ? 'bad photo' : 'no photo'}
                </span>
              </div>
            ))}
            {data.total === 0 && <p className="px-5 py-8 text-sm text-gray-400 text-center">No APLUS products need photos. 🎉</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function ResultGroup({ title, hint, tone, rows }: { title: string; hint: string; tone: 'green' | 'amber' | 'red'; rows: Result[] }) {
  const border = tone === 'green' ? 'border-green-200' : tone === 'amber' ? 'border-amber-200' : 'border-red-200'
  return (
    <section className={`bg-white rounded-xl border ${border} overflow-hidden`}>
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
              : <div className="w-12 h-12 rounded bg-gray-100 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 truncate">{r.name}</p>
              <p className="text-xs text-gray-400">
                {r.code ?? '—'}{r.source ? ` · ${r.source}` : ''}{r.reason && r.tier === 'none' ? ` · ${r.reason}` : ''}
              </p>
            </div>
            {r.flagged && <span className="text-[10px] bg-red-50 text-red-600 rounded-full px-2 py-0.5 shrink-0">AI flagged</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
