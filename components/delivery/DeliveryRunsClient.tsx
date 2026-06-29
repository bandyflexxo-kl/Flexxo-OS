'use client'

import { useEffect, useMemo, useState } from 'react'
import { zoneOptions } from '@/lib/deliveryZones'
import { priceRun }    from '@/lib/deliveryRun'

type Candidate = {
  orderId: string; doRef: string | null; company: string; address: string
  postcode: string | null; suggestedZoneId: string; suggestedKm: number
  contactName: string | null; contactPhone: string | null
  items: { name: string; qty: number }[]
}
type StopDraft = {
  zoneId: string; km: number; qty: number; address: string
  contactName: string; contactPhone: string
}
type RunSummary = {
  id: string; code: string; mode: string; status: string; maxKm: number
  totalQty: number; priceMyr: string | null; stops: number; sentAt: string | null; createdAt: string
}
type Preview = { id: string; code: string; price: number; message: string }

const ZONES = zoneOptions()

export default function DeliveryRunsClient() {
  const [candidates, setCandidates]   = useState<Candidate[]>([])
  const [runs, setRuns]               = useState<RunSummary[]>([])
  const [loading, setLoading]         = useState(true)
  const [mode, setMode]               = useState<'parcel' | 'pallet'>('parcel')
  const [sel, setSel]                 = useState<Record<string, StopDraft>>({})
  const [preview, setPreview]         = useState<Preview | null>(null)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [c, r] = await Promise.all([
      fetch('/api/delivery-runs/candidates').then(x => x.json()).catch(() => ({ candidates: [] })),
      fetch('/api/delivery-runs').then(x => x.json()).catch(() => ({ runs: [] })),
    ])
    setCandidates(c.candidates ?? [])
    setRuns(r.runs ?? [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  function toggle(c: Candidate) {
    setSel(prev => {
      const next = { ...prev }
      if (next[c.orderId]) delete next[c.orderId]
      else next[c.orderId] = {
        zoneId: c.suggestedZoneId, km: c.suggestedKm, qty: 1,
        address: c.address, contactName: c.contactName ?? '', contactPhone: c.contactPhone ?? '',
      }
      return next
    })
  }
  function patch(orderId: string, p: Partial<StopDraft>) {
    setSel(prev => ({ ...prev, [orderId]: { ...prev[orderId], ...p } }))
  }
  function pickZone(orderId: string, zoneId: string) {
    const z = ZONES.find(zz => zz.id === zoneId)
    patch(orderId, { zoneId, ...(z && z.id !== 'custom' ? { km: z.km } : {}) })
  }

  const selectedIds = Object.keys(sel)
  const live = useMemo(
    () => priceRun(mode, selectedIds.map(id => ({ km: sel[id].km, qty: sel[id].qty }))),
    [mode, sel], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const unit = mode === 'pallet' ? 'pallet' : 'box'

  async function createRun() {
    setError(null); setBusy(true); setPreview(null); setDispatchMsg(null)
    const stops = selectedIds.map(id => ({
      orderId: id, zoneId: sel[id].zoneId, km: sel[id].km, qty: sel[id].qty,
      address: sel[id].address || undefined,
      contactName: sel[id].contactName || undefined,
      contactPhone: sel[id].contactPhone || undefined,
    }))
    const res = await fetch('/api/delivery-runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, stops }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Could not create run — check the stops.'); return }
    setPreview({ id: body.run.id, code: body.run.code, price: body.run.price, message: body.run.message })
    setSel({})
  }

  async function dispatchRun(id: string) {
    setBusy(true); setDispatchMsg(null)
    const res = await fetch(`/api/delivery-runs/${id}/dispatch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const body = await res.json()
    setBusy(false)
    setDispatchMsg(!res.ok ? (body.error ?? 'Dispatch failed')
      : body.sent ? '✅ Sent to the partner group.'
      : `⚠️ ${body.sendError ?? 'Not sent'} — copy the message into the group.`)
    void load()
  }

  function copy(text: string) { navigator.clipboard?.writeText(text).catch(() => undefined) }

  return (
    <div className="space-y-6">
      {/* Compile a new run */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Compile a delivery run</h2>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['parcel', 'pallet'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 capitalize ${mode === m ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {m === 'parcel' ? '📦 Parcels' : '🟫 Pallets'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Loading packed orders…</p>
        ) : candidates.length === 0 ? (
          <p className="text-gray-500 text-sm">No packed orders waiting for delivery.</p>
        ) : (
          <div className="space-y-2">
            {candidates.map(c => {
              const on = !!sel[c.orderId]
              const s  = sel[c.orderId]
              return (
                <div key={c.orderId} className={`rounded-xl border p-3 ${on ? 'border-green-400 bg-green-50/40' : 'border-gray-200'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => toggle(c)} className="mt-1 accent-green-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 text-sm">{c.company}
                        {c.doRef && <span className="text-gray-400 font-normal"> · {c.doRef}</span>}</div>
                      <div className="text-xs text-gray-500 truncate">{c.address || 'No address on file'}</div>
                      <div className="text-xs text-gray-400">{c.items.slice(0, 4).map(i => `${i.qty}× ${i.name}`).join(', ')}{c.items.length > 4 ? ` +${c.items.length - 4}` : ''}</div>
                    </div>
                  </label>

                  {on && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 pl-7">
                      <label className="text-xs text-gray-500 col-span-2 sm:col-span-1">Zone
                        <select value={s.zoneId} onChange={e => pickZone(c.orderId, e.target.value)}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900">
                          {ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-gray-500">Km
                        <input type="number" min={0} value={s.km}
                          onChange={e => patch(c.orderId, { km: Number(e.target.value) })}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                      </label>
                      <label className="text-xs text-gray-500">{unit === 'pallet' ? 'Pallets' : 'Boxes'}
                        <input type="number" min={1} value={s.qty}
                          onChange={e => patch(c.orderId, { qty: Math.max(1, Number(e.target.value)) })}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                      </label>
                      <label className="text-xs text-gray-500 col-span-2 sm:col-span-4">Confirm delivery address
                        <input value={s.address} onChange={e => patch(c.orderId, { address: e.target.value })}
                          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" />
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{selectedIds.length}</span> stop{selectedIds.length > 1 ? 's' : ''} ·{' '}
              <span className="font-semibold text-gray-900">{live.totalQty}</span> {unit}{live.totalQty > 1 ? (unit === 'box' ? 'es' : 's') : ''} ·{' '}
              ~{live.maxKm} km → <span className="font-semibold text-green-700">RM {live.price.toFixed(2)}</span>
            </div>
            <button onClick={createRun} disabled={busy}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {busy ? 'Working…' : 'Create run'}
            </button>
          </div>
        )}
      </section>

      {/* Preview + dispatch the just-created run */}
      {preview && (
        <section className="bg-white rounded-2xl border border-green-300 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{preview.code} ready · RM {preview.price.toFixed(2)}</h2>
            <div className="flex gap-2">
              <button onClick={() => copy(preview.message)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">Copy message</button>
              <button onClick={() => dispatchRun(preview.id)} disabled={busy}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
                Send to partner group
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-xs text-gray-700 bg-gray-50 rounded-lg p-3 max-h-72 overflow-auto">{preview.message}</pre>
          {dispatchMsg && <p className="text-sm text-gray-700">{dispatchMsg}</p>}
        </section>
      )}

      {/* Recent runs */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-gray-400 text-sm">No runs yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {runs.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="font-medium text-gray-900">{r.code}</span>
                  <span className="text-gray-400"> · {r.mode} · {r.stops} stop{r.stops > 1 ? 's' : ''} · {r.totalQty} {r.mode === 'pallet' ? 'plt' : 'box'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-700">RM {r.priceMyr ? Number(r.priceMyr).toFixed(2) : '—'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'dispatched' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
