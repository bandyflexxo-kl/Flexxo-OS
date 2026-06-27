'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type PanelVendor = {
  id: string
  supplierId: string
  supplierName: string
  replyStatus: string
  quoteValidityDays: number | null
  rfqSentAt: string | null
  stars: number
  avgReplyHours: number | null
  won: number
}

type SupplierOpt = { id: string; name: string; stars: number; invited: number }

const REPLY_STATES = ['sent', 'acknowledged', 'price_received', 'no_response'] as const
const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent', acknowledged: 'Acknowledged', price_received: 'Price received', no_response: 'No response',
}
const STATUS_TONE: Record<string, string> = {
  sent: 'bg-blue-50 text-blue-700', acknowledged: 'bg-indigo-50 text-indigo-700',
  price_received: 'bg-green-50 text-green-700', no_response: 'bg-gray-100 text-gray-500',
}

function Stars({ n }: { n: number }) {
  if (!n) return <span className="text-gray-300 text-xs">no history</span>
  return <span className="text-amber-500 text-xs" title={`${n}/5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>
}

export default function TenderRfqPanel({
  tenderId, vendors, allSuppliers, canEdit, canGate, minQuotesRequired,
}: {
  tenderId: string
  vendors: PanelVendor[]
  allSuppliers: SupplierOpt[]
  canEdit: boolean
  canGate: boolean
  minQuotesRequired: number | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const priceReceived = vendors.filter(v => v.replyStatus === 'price_received').length

  async function api(method: string, body: unknown) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/tenders/${tenderId}/vendors`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Action failed')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(v: PanelVendor, status: string) { await api('PATCH', { vendorId: v.id, replyStatus: status }) }
  async function setValidity(v: PanelVendor, days: string) {
    await api('PATCH', { vendorId: v.id, quoteValidityDays: days.trim() ? Number(days) : null })
  }
  async function markSent(v: PanelVendor) { await api('PATCH', { vendorId: v.id, markSent: true }) }
  async function remove(v: PanelVendor) { await api('DELETE', { vendorId: v.id }) }
  async function addPicked() {
    if (picked.size === 0) return
    await api('POST', { supplierIds: [...picked] })
    setPicked(new Set()); setAdding(false); setSearch('')
  }

  async function gate2(force = false) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gate2`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.warning === 'min_quotes') {
        if (confirm(`${json.message}`)) { await gate2(true); return }
        setBusy(false); return
      }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Award failed')
      if (json.qneNote) alert(`Awarded. Note: QNE project — ${json.qneNote}`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Award failed')
      setBusy(false)
    }
  }

  const invitedIds = new Set(vendors.map(v => v.supplierId))
  const pickable = allSuppliers
    .filter(s => !invitedIds.has(s.id))
    .filter(s => !search.trim() || s.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          RFQ — vendors ({vendors.length})
          <span className="ml-2 text-xs font-normal text-gray-400">{priceReceived} priced</span>
        </h2>
        {canEdit && (
          <button onClick={() => setAdding(a => !a)} className="text-sm font-medium text-blue-600 hover:text-blue-700">
            {adding ? 'Close' : '+ Add vendor'}
          </button>
        )}
      </div>

      {minQuotesRequired != null && (
        <p className={`text-xs ${priceReceived >= minQuotesRequired ? 'text-green-600' : 'text-amber-600'}`}>
          Min. quotes rule: {priceReceived}/{minQuotesRequired} priced quotes received
        </p>
      )}

      {/* Add-vendor picker */}
      {adding && canEdit && (
        <div className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50/50">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Search suppliers…" value={search} onChange={e => setSearch(e.target.value)}
          />
          <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 bg-white rounded border border-gray-100">
            {pickable.slice(0, 100).map(s => (
              <label key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={e => setPicked(p => {
                    const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n
                  })} />
                  {s.name}
                </span>
                <Stars n={s.stars} />
              </label>
            ))}
            {pickable.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No more suppliers.</p>}
          </div>
          <button onClick={addPicked} disabled={busy || picked.size === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm px-3 py-1.5 rounded-lg">
            Add {picked.size > 0 ? `(${picked.size})` : ''}
          </button>
        </div>
      )}

      {/* Vendor table */}
      {vendors.length === 0 ? (
        <p className="text-sm text-gray-400">No vendors invited yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-2">Supplier</th>
                <th className="py-2 pr-2">Performance</th>
                <th className="py-2 pr-2">Reply status</th>
                <th className="py-2 pr-2">Validity (days)</th>
                <th className="py-2 pr-2">RFQ</th>
                {canEdit && <th className="py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.id} className="border-b border-gray-50">
                  <td className="py-2 pr-2 text-gray-900">{v.supplierName}</td>
                  <td className="py-2 pr-2">
                    <Stars n={v.stars} />
                    {v.avgReplyHours != null && <span className="ml-2 text-xs text-gray-400">~{v.avgReplyHours}h reply</span>}
                  </td>
                  <td className="py-2 pr-2">
                    {canEdit ? (
                      <select
                        value={v.replyStatus} disabled={busy}
                        onChange={e => setStatus(v, e.target.value)}
                        className={`text-xs rounded-full px-2 py-1 border-0 ${STATUS_TONE[v.replyStatus] ?? ''}`}
                      >
                        {REPLY_STATES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[v.replyStatus] ?? ''}`}>
                        {STATUS_LABEL[v.replyStatus] ?? v.replyStatus}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {canEdit ? (
                      <input
                        type="number" defaultValue={v.quoteValidityDays ?? ''} disabled={busy}
                        onBlur={e => { if (e.target.value !== String(v.quoteValidityDays ?? '')) setValidity(v, e.target.value) }}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-xs" placeholder="—"
                      />
                    ) : (v.quoteValidityDays ?? '—')}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    <a href={`/api/tenders/${tenderId}/rfq-pdf?supplierId=${v.supplierId}`} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:underline text-xs">PDF</a>
                    {canEdit && !v.rfqSentAt && (
                      <button onClick={() => markSent(v)} disabled={busy} className="ml-2 text-xs text-gray-500 hover:text-gray-800">mark sent</button>
                    )}
                    {v.rfqSentAt && <span className="ml-2 text-xs text-gray-300">sent ✓</span>}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <button onClick={() => remove(v)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Remove">✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Gate 2 */}
      {canGate && (
        <div className="border-t border-gray-100 pt-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-800">Gate 2 — client award</p>
            <p className="text-xs text-gray-400">Confirm the client awarded the job to Flexxo to unlock price evaluation (Stage 3).</p>
          </div>
          <button onClick={() => gate2(false)} disabled={busy}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0">
            ✓ Confirm client award
          </button>
        </div>
      )}
    </section>
  )
}
