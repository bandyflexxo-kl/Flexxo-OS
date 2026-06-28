'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type CpItem = { id: string; pos: number; name: string; unit: string | null; qty: number; awardedUnitPrice: number | null }
export type CpPo = { id: string; poNumber: string; value: number; dateReceived: string; itemCount: number }

const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm'

export default function TenderClientPoPanel({
  tenderId, items, pos, estValue, canEdit, canGate3,
}: {
  tenderId: string
  items: CpItem[]
  pos: CpPo[]
  estValue: number | null
  canEdit: boolean
  canGate3: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [poNumber, setPoNumber] = useState('')
  const [dateReceived, setDate] = useState('')
  const [picName, setPicName] = useState('')
  const [picEmail, setPicEmail] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const totalCovered = pos.reduce((s, p) => s + p.value, 0)
  const coverage = estValue && estValue > 0 ? Math.min(100, (totalCovered / estValue) * 100) : null

  async function addPo() {
    setBusy(true); setErr(null)
    try {
      const lines = items
        .filter(it => qty[it.id]?.trim() && Number(qty[it.id]) > 0)
        .map(it => ({ tenderItemId: it.id, qtyCovered: Number(qty[it.id]) }))
      if (!poNumber.trim()) { setErr('PO number required.'); setBusy(false); return }
      if (lines.length === 0) { setErr('Enter at least one covered quantity.'); setBusy(false); return }
      const res = await fetch(`/api/tenders/${tenderId}/client-po`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poNumber, dateReceived: dateReceived ? new Date(dateReceived).toISOString() : undefined, picName: picName || null, picEmail: picEmail || null, items: lines }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed')
      setAdding(false); setPoNumber(''); setQty({}); router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }

  async function gate3() {
    if (!confirm('Confirm the client PO is in place? This unlocks supplier PO issuance.')) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/tenders/${tenderId}/gate3`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed')
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setBusy(false) }
  }

  function chaseEmail() {
    const subj = encodeURIComponent('Follow-up: Purchase Order')
    const body = encodeURIComponent(`Dear Sir/Madam,\n\nThank you for awarding the tender to Flexxo. We are ready to proceed and would appreciate receiving your official Purchase Order at your earliest convenience.\n\nBest regards,\nFlexxo (KL) Sdn Bhd`)
    window.open(`mailto:${picEmail || ''}?subject=${subj}&body=${body}`)
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Client PO tracking ({pos.length})</h2>
        {canEdit && <button onClick={() => setAdding(a => !a)} className="text-sm font-medium text-blue-600 hover:text-blue-700">{adding ? 'Close' : '+ Log client PO'}</button>}
      </div>

      {/* Coverage */}
      {coverage != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>PO coverage</span><span>RM {totalCovered.toLocaleString('en-MY')} / {estValue!.toLocaleString('en-MY')} ({coverage.toFixed(0)}%)</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${coverage}%` }} /></div>
        </div>
      )}

      {/* Existing POs */}
      {pos.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-2">PO #</th><th className="py-2">Received</th><th className="py-2">Items</th><th className="py-2 text-right">Value</th></tr></thead>
          <tbody>
            {pos.map(p => (
              <tr key={p.id} className="border-b border-gray-50"><td className="py-2">{p.poNumber}</td><td className="py-2 text-gray-500">{new Date(p.dateReceived).toLocaleDateString('en-MY')}</td><td className="py-2 text-gray-500">{p.itemCount}</td><td className="py-2 text-right">RM {p.value.toLocaleString('en-MY')}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add form */}
      {adding && canEdit && (
        <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input className={inp} placeholder="PO number *" value={poNumber} onChange={e => setPoNumber(e.target.value)} />
            <input className={inp} type="date" value={dateReceived} onChange={e => setDate(e.target.value)} />
            <input className={inp} placeholder="PIC name" value={picName} onChange={e => setPicName(e.target.value)} />
            <input className={inp} placeholder="PIC email" value={picEmail} onChange={e => setPicEmail(e.target.value)} />
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400"><th className="py-1">Item</th><th className="py-1 w-24">Awarded qty</th><th className="py-1 w-28">Covered qty</th></tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}><td className="py-1">{it.pos}. {it.name}</td><td className="py-1 text-gray-500">{it.qty}</td>
                  <td className="py-1"><input className="w-24 border border-gray-200 rounded px-2 py-1" type="number" value={qty[it.id] ?? ''} onChange={e => setQty(p => ({ ...p, [it.id]: e.target.value }))} placeholder="0" /></td></tr>
              ))}
            </tbody>
          </table>
          <button onClick={addPo} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm px-3.5 py-2 rounded-lg">Save client PO</button>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
        {canEdit && <button onClick={chaseEmail} className="text-sm border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-lg">✉ Draft chase email</button>}
        {canGate3 && <button onClick={gate3} disabled={busy || pos.length === 0} className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg">✓ Confirm client PO (Gate 3)</button>}
      </div>
    </section>
  )
}
