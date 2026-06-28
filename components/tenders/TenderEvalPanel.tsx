'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { variancePct, rankVendors, optimiseSplitAward, type QuoteCell } from '@/lib/tenderEvaluation'

export type EvalItemProp = { id: string; pos: number; name: string; unit: string | null; qty: number; normalUnitPrice: number | null; targetPrice: number | null; suggestedNormal: number | null }
export type EvalVendorProp = { supplierId: string; supplierName: string }
export type EvalQuoteProp = { tenderItemId: string; supplierId: string; quotedUnitPrice: number }

const inp = 'w-20 border border-gray-200 rounded px-1.5 py-1 text-xs text-right'

export default function TenderEvalPanel({
  tenderId, items, vendors, quotes, threshold, canEdit,
}: {
  tenderId: string
  items: EvalItemProp[]
  vendors: EvalVendorProp[]
  quotes: EvalQuoteProp[]
  threshold: number
  canEdit: boolean
}) {
  const router = useRouter()
  const key = (i: string, s: string) => `${i}::${s}`

  const [normals, setNormals] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map(it => [it.id, it.normalUnitPrice != null ? String(it.normalUnitPrice) : (it.suggestedNormal != null ? String(it.suggestedNormal) : '')])))
  const [cells, setCells] = useState<Record<string, string>>(() =>
    Object.fromEntries(quotes.map(q => [key(q.tenderItemId, q.supplierId), String(q.quotedUnitPrice)])))
  const [awards, setAwards] = useState<Record<string, { supplierId: string; price: string; reason: string }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Live quote cells for ranking/optimiser
  const liveQuotes: QuoteCell[] = useMemo(() => {
    const out: QuoteCell[] = []
    for (const it of items) for (const v of vendors) {
      const raw = cells[key(it.id, v.supplierId)]
      if (raw != null && raw !== '') out.push({ tenderItemId: it.id, supplierId: v.supplierId, quotedUnitPrice: Number(raw) })
    }
    return out
  }, [cells, items, vendors])

  const ranks = useMemo(() => rankVendors(items.map(i => ({ id: i.id, qty: i.qty, normalUnitPrice: null, targetPrice: null })), liveQuotes), [items, liveQuotes])
  const nameOf = (sid: string) => vendors.find(v => v.supplierId === sid)?.supplierName ?? sid

  function cellVariance(itemId: string, supplierId: string): number | null {
    const raw = cells[key(itemId, supplierId)]
    if (raw == null || raw === '') return null
    const n = normals[itemId]
    return variancePct(Number(raw), n ? Number(n) : null)
  }

  async function saveQuotes() {
    setBusy(true); setMsg(null); setErr(null)
    try {
      const body = {
        normals: items.map(it => ({ tenderItemId: it.id, normalUnitPrice: normals[it.id]?.trim() ? Number(normals[it.id]) : null })),
        quotes: liveQuotes,
      }
      const res = await fetch(`/api/tenders/${tenderId}/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Save failed')
      setMsg(`Saved ${j.saved} quotes.`); router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }

  function applyOptimiser() {
    const picks = optimiseSplitAward(liveQuotes)
    const next: typeof awards = {}
    for (const p of picks) next[p.tenderItemId] = { supplierId: p.supplierId, price: String(p.quotedUnitPrice), reason: '' }
    setAwards(next)
    setMsg('Lowest-cost vendor selected per item — review, adjust the tender price, then lock.')
  }

  function setAward(itemId: string, patch: Partial<{ supplierId: string; price: string; reason: string }>) {
    setAwards(prev => {
      const cur = prev[itemId] ?? { supplierId: '', price: '', reason: '' }
      return { ...prev, [itemId]: { ...cur, ...patch } }
    })
  }

  async function lockPrices() {
    setBusy(true); setMsg(null); setErr(null)
    try {
      const awardArr = items.map(it => {
        const a = awards[it.id]
        return a && a.supplierId ? { tenderItemId: it.id, supplierId: a.supplierId, awardedUnitPrice: Number(a.price || 0), overrideReason: a.reason?.trim() || undefined } : null
      })
      if (awardArr.some(a => a == null)) { setErr('Select an awarded vendor for every item before locking.'); setBusy(false); return }
      if (!confirm('Lock all tender prices? After locking, no role can change the awarded prices.')) { setBusy(false); return }
      const res = await fetch(`/api/tenders/${tenderId}/award`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ awards: awardArr }) })
      const j = await res.json()
      if (res.status === 422) { setErr(j.error || 'A justification is required for a flagged item.'); setBusy(false); return }
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Lock failed')
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Lock failed') } finally { setBusy(false) }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Price evaluation</h2>
        <span className="text-xs text-gray-400">variance threshold: {threshold}%</span>
      </div>

      {/* Quote matrix */}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="py-1 pr-3 sticky left-0 bg-white">Item</th>
              <th className="py-1 px-2">Qty</th>
              <th className="py-1 px-2">Normal</th>
              {vendors.map(v => <th key={v.supplierId} className="py-1 px-2 whitespace-nowrap">{v.supplierName}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="border-t border-gray-50">
                <td className="py-1 pr-3 sticky left-0 bg-white text-gray-800 max-w-[200px] truncate" title={it.name}>{it.pos}. {it.name}</td>
                <td className="py-1 px-2 text-gray-500">{it.qty}{it.unit ? ` ${it.unit}` : ''}</td>
                <td className="py-1 px-2">
                  <input className={inp} type="number" disabled={!canEdit} value={normals[it.id] ?? ''}
                    onChange={e => setNormals(p => ({ ...p, [it.id]: e.target.value }))} placeholder="—" />
                </td>
                {vendors.map(v => {
                  const vpct = cellVariance(it.id, v.supplierId)
                  const flagged = vpct != null && vpct > threshold
                  return (
                    <td key={v.supplierId} className={`py-1 px-2 ${flagged ? 'bg-red-50' : ''}`}>
                      <input className={inp} type="number" disabled={!canEdit} value={cells[key(it.id, v.supplierId)] ?? ''}
                        onChange={e => setCells(p => ({ ...p, [key(it.id, v.supplierId)]: e.target.value }))} placeholder="—" />
                      {vpct != null && <div className={`text-[10px] mt-0.5 ${flagged ? 'text-red-600 font-medium' : vpct < 0 ? 'text-green-600' : 'text-gray-400'}`}>{vpct > 0 ? '+' : ''}{vpct.toFixed(1)}%</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button onClick={saveQuotes} disabled={busy} className="bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-sm px-3.5 py-2 rounded-lg">Save quotes</button>
          <button onClick={applyOptimiser} disabled={busy || liveQuotes.length === 0} className="border border-gray-300 hover:bg-gray-50 text-sm px-3.5 py-2 rounded-lg">✨ Suggest lowest-cost split</button>
          {msg && <span className="text-xs text-green-600">{msg}</span>}
        </div>
      )}

      {/* Vendor ranking */}
      {ranks.length > 0 && (
        <div className="text-xs text-gray-600">
          <span className="font-medium text-gray-700">Ranking (total of quoted items): </span>
          {ranks.map(r => <span key={r.supplierId} className="mr-3">{r.rank}. {nameOf(r.supplierId)} — RM {r.total.toLocaleString('en-MY', { minimumFractionDigits: 2 })} <span className="text-gray-400">({r.itemsQuoted}/{items.length})</span></span>)}
        </div>
      )}

      {/* Award + lock */}
      {canEdit && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-800">Award &amp; lock</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400">
                <th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Awarded vendor</th><th className="py-1 pr-2">Tender price</th><th className="py-1 pr-2">Override reason (if flagged)</th>
              </tr></thead>
              <tbody>
                {items.map(it => {
                  const a = awards[it.id]
                  const quotedVendors = vendors.filter(v => cells[key(it.id, v.supplierId)])
                  const flagged = a?.supplierId ? (cellVariance(it.id, a.supplierId) ?? 0) > threshold : false
                  return (
                    <tr key={it.id} className="border-t border-gray-50">
                      <td className="py-1 pr-2 max-w-[180px] truncate" title={it.name}>{it.pos}. {it.name}</td>
                      <td className="py-1 pr-2">
                        <select className="border border-gray-200 rounded px-1.5 py-1 text-xs" value={a?.supplierId ?? ''}
                          onChange={e => { const sid = e.target.value; setAward(it.id, { supplierId: sid, price: cells[key(it.id, sid)] ?? a?.price ?? '' }) }}>
                          <option value="">—</option>
                          {quotedVendors.map(v => <option key={v.supplierId} value={v.supplierId}>{v.supplierName} (RM {cells[key(it.id, v.supplierId)]})</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2"><input className={inp} type="number" value={a?.price ?? ''} onChange={e => setAward(it.id, { price: e.target.value })} /></td>
                      <td className="py-1 pr-2">{flagged && <input className="w-48 border border-red-300 rounded px-1.5 py-1 text-xs" placeholder="required — justify >threshold" value={a?.reason ?? ''} onChange={e => setAward(it.id, { reason: e.target.value })} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button onClick={lockPrices} disabled={busy} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">🔒 Lock prices &amp; award</button>
          {err && <span className="ml-3 text-sm text-red-600">{err}</span>}
        </div>
      )}
      {!canEdit && err && <p className="text-sm text-red-600">{err}</p>}
    </section>
  )
}
