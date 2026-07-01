'use client'

/**
 * Lotus's price-match tool — paste/upload a pantry list, identify each item,
 * search lotuss.com.my for the top 3 matches, pick one per item, enter its price,
 * then produce a final list (search-item name, image, price ×1.2, link) that
 * downloads as a PDF (no link in the PDF). All history lives in localStorage.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Result = { name: string; link: string; image: string | null }
type Row = { term: string; results: Result[]; loading: boolean; selected: number | null; price: string }
type FinalRow = { searchItem: string; name: string; link: string; image: string | null; price: number }
type History = { id: string; dateISO: string; title: string; rows: FinalRow[] }

const HISTORY_KEY = 'lotuss_match_history_v1'
const MARKUP = 1.2

const fileToB64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1] ?? '')
  r.onerror = rej
  r.readAsDataURL(f)
})

async function pool<T>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx) }
  })
  await Promise.all(workers)
}

export default function LotussMatchClient() {
  const [phase, setPhase]   = useState<'input' | 'review' | 'final'>('input')
  const [text, setText]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [rows, setRows]     = useState<Row[]>([])
  const [title, setTitle]   = useState('')
  const [finalRows, setFinalRows] = useState<FinalRow[]>([])
  const [history, setHistory]     = useState<History[]>([])
  const [openHist, setOpenHist]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); if (Array.isArray(h)) setHistory(h) } catch { /* */ }
  }, [])
  const saveHistory = (h: History[]) => { setHistory(h); try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))) } catch { /* */ } }

  // ── Identify items, then search each ────────────────────────────────────────
  async function identify(body: object) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/lotuss/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) { setError(typeof d.error === 'string' ? d.error : 'Could not read the list.'); return }
      const items: string[] = d.items ?? []
      if (!items.length) { setError('No items found.'); return }
      const init: Row[] = items.map(t => ({ term: t, results: [], loading: true, selected: null, price: '' }))
      setRows(init); setPhase('review')
      void pool(items, 3, async (q, idx) => { await searchOne(idx, q) })
    } catch { setError('Something went wrong reading the list.') }
    finally { setBusy(false) }
  }

  async function searchOne(idx: number, query: string) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, loading: true } : r))
    try {
      const r = await fetch('/api/lotuss/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, count: 3 }) })
      const d = await r.json().catch(() => ({ results: [] }))
      setRows(prev => prev.map((row, i) => i === idx ? { ...row, results: d.results ?? [], loading: false, selected: null } : row))
    } catch {
      setRows(prev => prev.map((row, i) => i === idx ? { ...row, results: [], loading: false } : row))
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setBusy(true); setError(null)
    try {
      const b64 = await fileToB64(f)
      if (f.type === 'application/pdf') await identify({ pdf: b64 })
      else if (f.type.startsWith('image/')) await identify({ image: { data: b64, mimeType: f.type } })
      else setError('Upload a PDF or an image.')
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  // ── Review actions ──────────────────────────────────────────────────────────
  const setRow = (i: number, patch: Partial<Row>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  function confirmList() {
    const chosen = rows.filter(r => r.selected !== null && r.results[r.selected])
    if (chosen.length === 0) { setError('Pick at least one match.'); return }
    const fr: FinalRow[] = chosen.map(r => {
      const res = r.results[r.selected!]
      const p = parseFloat(r.price)
      return { searchItem: r.term, name: res.name, link: res.link, image: res.image, price: Number.isFinite(p) ? p : 0 }
    })
    setFinalRows(fr)
    // save to localStorage history
    const entry: History = { id: crypto.randomUUID(), dateISO: new Date().toISOString(), title: title.trim() || `Match ${new Date().toLocaleDateString('en-MY')}`, rows: fr }
    saveHistory([entry, ...history])
    setPhase('final')
    setError(null)
  }

  async function downloadPdf(fr: FinalRow[], pdfTitle: string) {
    const r = await fetch('/api/lotuss/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: pdfTitle, rows: fr, markup: MARKUP }) })
    if (!r.ok) { setError('Could not generate the PDF.'); return }
    const blob = await r.blob()
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${pdfTitle.replace(/[^\w -]/g, '')}.pdf`; a.click()
    URL.revokeObjectURL(url)
  }

  function reset() { setPhase('input'); setRows([]); setFinalRows([]); setText(''); setTitle(''); setError(null) }

  const money = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lotus&apos;s Price Match</h1>
          <p className="text-xs text-gray-400 mt-0.5">Paste or upload a pantry list → match to Lotus&apos;s → mark up ×1.2 → download PDF.</p>
        </div>
        <Link href="/quotations" className="text-sm text-gray-500 hover:text-gray-700">← Quotations</Link>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* ── INPUT ── */}
      {phase === 'input' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="List title (optional, e.g. Aeon Pantry Jul)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-400" />
          <textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder="Paste your pantry items here, one per line…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-400 resize-none" />
          <div className="flex items-center gap-3">
            <button disabled={busy || !text.trim()} onClick={() => void identify({ text })}
              className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
              {busy ? 'Working…' : 'Identify & search'}
            </button>
            <span className="text-xs text-gray-400">or</span>
            <button disabled={busy} onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors">
              ⬆ Upload image / PDF
            </button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => void onFile(e.target.files?.[0])} />
          </div>
        </div>
      )}

      {/* ── REVIEW ── */}
      {phase === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">{rows.length} item{rows.length !== 1 ? 's' : ''} — pick one Lotus&apos;s match per item and enter its price.</p>
            <div className="flex gap-2">
              <button onClick={reset} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Start over</button>
              <button onClick={confirmList} className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">Confirm list →</button>
            </div>
          </div>

          {rows.map((row, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-gray-400 shrink-0">#{i + 1}</span>
                <input value={row.term} onChange={e => setRow(i, { term: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-green-400" />
                <button onClick={() => void searchOne(i, row.term)} disabled={row.loading}
                  className="px-3 py-1.5 text-xs font-medium border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50">
                  {row.loading ? 'Searching…' : '↻ Find again'}
                </button>
              </div>

              {row.loading ? (
                <p className="text-xs text-gray-400 px-1 py-3">Searching Lotus&apos;s…</p>
              ) : row.results.length === 0 ? (
                <p className="text-xs text-gray-400 px-1 py-3">No Lotus&apos;s match — edit the term and Find again.</p>
              ) : (
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {row.results.map((res, ri) => (
                    <label key={ri}
                      className={`block rounded-xl border p-2.5 cursor-pointer transition-colors ${row.selected === ri ? 'border-green-500 bg-green-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-start gap-2">
                        <input type="radio" name={`m-${i}`} checked={row.selected === ri} onChange={() => setRow(i, { selected: ri })} className="mt-0.5 accent-green-600" />
                        <div className="min-w-0 flex-1">
                          {res.image
                            /* eslint-disable-next-line @next/next/no-img-element */
                            ? <img src={res.image} alt="" className="w-full h-20 object-contain rounded bg-white mb-1.5" />
                            : <div className="w-full h-20 rounded bg-gray-100 mb-1.5 flex items-center justify-center text-gray-300 text-xs">no image</div>}
                          <p className="text-[11px] font-medium text-gray-800 leading-snug line-clamp-2">{res.name}</p>
                          <a href={res.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] text-green-600 hover:underline">view on Lotus&apos;s →</a>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {row.selected !== null && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                  <span className="text-xs text-gray-500">Lotus&apos;s price (RM):</span>
                  <input value={row.price} onChange={e => setRow(i, { price: e.target.value })} inputMode="decimal" placeholder="0.00"
                    className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-400" />
                  {parseFloat(row.price) > 0 && <span className="text-xs text-gray-400">→ ×1.2 = <span className="font-semibold text-gray-700">RM {money(parseFloat(row.price) * MARKUP)}</span></span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── FINAL ── */}
      {phase === 'final' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">{finalRows.length} matched items · marked up ×1.2</p>
            <div className="flex gap-2">
              <button onClick={reset} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">New match</button>
              <button onClick={() => void downloadPdf(finalRows, title.trim() || 'Lotus Price Match')} className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">⬇ Download PDF</button>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
            {finalRows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                {r.image
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={r.image} alt="" className="w-14 h-14 object-contain rounded bg-white shrink-0" />
                  : <div className="w-14 h-14 rounded bg-gray-100 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.searchItem}</p>
                  <a href={r.link} target="_blank" rel="noreferrer" className="text-[11px] text-green-600 hover:underline">Lotus&apos;s reference →</a>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-900 tabular-nums">RM {money(r.price * MARKUP)}</p>
                  <p className="text-[10px] text-gray-400">Lotus&apos;s RM {money(r.price)} ×1.2</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">The downloaded PDF shows your item names, images, and the ×1.2 price — no Lotus&apos;s links.</p>
        </div>
      )}

      {/* ── HISTORY (localStorage) ── */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Search history <span className="text-gray-400 font-normal">({history.length})</span></h2>
            <button onClick={() => { if (confirm('Clear all saved search history?')) saveHistory([]) }} className="text-xs text-red-500 hover:text-red-600">Clear history</button>
          </div>
          <div className="divide-y divide-gray-50">
            {history.map(h => (
              <div key={h.id} className="py-2">
                <button onClick={() => setOpenHist(openHist === h.id ? null : h.id)} className="w-full flex items-center justify-between text-left">
                  <span className="text-sm text-gray-800">{h.title}</span>
                  <span className="text-xs text-gray-400">{new Date(h.dateISO).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.rows.length} items {openHist === h.id ? '▲' : '▼'}</span>
                </button>
                {openHist === h.id && (
                  <div className="mt-2 space-y-1.5">
                    {h.rows.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="flex-1 truncate">{r.searchItem} <span className="text-gray-400">— {r.name}</span></span>
                        <span className="tabular-nums text-gray-700 font-medium">RM {money(r.price * MARKUP)}</span>
                      </div>
                    ))}
                    <button onClick={() => void downloadPdf(h.rows, h.title)} className="mt-1 text-xs font-medium text-green-600 hover:text-green-700">⬇ Download PDF again</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
