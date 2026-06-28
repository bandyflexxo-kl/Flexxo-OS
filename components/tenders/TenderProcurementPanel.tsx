'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type BalRow = { tenderItemId: string; name: string; unit: string | null; awardedQty: number; orderedQty: number; deliveredQty: number; openQty: number; remainingQty: number; utilisationPct: number }
export type AwItem = { id: string; name: string; unit: string | null; awardedSupplierId: string | null; remainingQty: number }
export type AwSupplier = { id: string; name: string }
export type PoLine = { id: string; itemName: string; unit: string | null; qty: number; received: number }
export type PoRow = { id: string; poNumber: string; supplierName: string; status: string; ackDate: string | null; lines: PoLine[] }

const inp = 'border border-gray-300 rounded px-2 py-1 text-sm'

export default function TenderProcurementPanel({
  tenderId, balance, awItems, suppliers, pos, canIssue, canReceive, canClose,
}: {
  tenderId: string
  balance: BalRow[]
  awItems: AwItem[]
  suppliers: AwSupplier[]
  pos: PoRow[]
  canIssue: boolean
  canReceive: boolean
  canClose: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [delDate, setDelDate] = useState('')
  const [delLoc, setDelLoc] = useState('')
  const [orderQty, setOrderQty] = useState<Record<string, string>>({})
  const [grnFor, setGrnFor] = useState<string | null>(null)
  const [recv, setRecv] = useState<Record<string, string>>({})

  async function call(path: string, body: unknown, method = 'POST') {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Action failed')
      if (j.qneNote) alert(`Saved. QNE note: ${j.qneNote}`)
      router.refresh(); return true
    } catch (e) { setErr(e instanceof Error ? e.message : 'Action failed'); return false }
    finally { setBusy(false) }
  }

  const supplierItems = awItems.filter(i => i.awardedSupplierId === supplierId && i.remainingQty > 0)

  async function issuePo() {
    const lines = supplierItems.filter(i => orderQty[i.id]?.trim() && Number(orderQty[i.id]) > 0).map(i => ({ tenderItemId: i.id, qty: Number(orderQty[i.id]) }))
    if (!supplierId) { setErr('Pick a supplier.'); return }
    if (lines.length === 0) { setErr('Enter order quantities.'); return }
    const ok = await call(`/api/tenders/${tenderId}/supplier-po`, { supplierId, deliveryDate: delDate ? new Date(delDate).toISOString() : null, deliveryLocation: delLoc || null, items: lines })
    if (ok) { setIssuing(false); setOrderQty({}); setSupplierId('') }
  }

  async function saveGrn(po: PoRow) {
    const lines = po.lines.filter(l => recv[l.id]?.trim() && Number(recv[l.id]) > 0).map(l => ({ supplierPoItemId: l.id, qtyReceived: Number(recv[l.id]) }))
    if (lines.length === 0) { setErr('Enter received quantities.'); return }
    const ok = await call(`/api/tenders/${tenderId}/grn`, { supplierPoId: po.id, lines })
    if (ok) { setGrnFor(null); setRecv({}) }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      <h2 className="text-sm font-semibold text-gray-900">Procurement &amp; delivery</h2>

      {/* Balance tracker */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-1.5">Item</th><th className="py-1.5 text-right">Awarded</th><th className="py-1.5 text-right">Ordered</th><th className="py-1.5 text-right">Delivered</th><th className="py-1.5 text-right">Open</th><th className="py-1.5 text-right">To order</th><th className="py-1.5 w-24">Util%</th>
          </tr></thead>
          <tbody>
            {balance.map(b => (
              <tr key={b.tenderItemId} className="border-b border-gray-50">
                <td className="py-1.5 text-gray-800 max-w-[200px] truncate" title={b.name}>{b.name}</td>
                <td className="py-1.5 text-right">{b.awardedQty}</td>
                <td className="py-1.5 text-right">{b.orderedQty}</td>
                <td className="py-1.5 text-right">{b.deliveredQty}</td>
                <td className="py-1.5 text-right text-amber-600">{b.openQty}</td>
                <td className="py-1.5 text-right font-medium">{b.remainingQty}</td>
                <td className="py-1.5"><div className="h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(100, b.utilisationPct)}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issue PO */}
      {canIssue && (
        <div className="border-t border-gray-100 pt-4">
          <button onClick={() => setIssuing(v => !v)} className="text-sm font-medium text-blue-600 hover:text-blue-700">{issuing ? 'Close' : '+ Issue supplier PO'}</button>
          {issuing && (
            <div className="border border-gray-100 rounded-lg p-3 mt-2 space-y-3 bg-gray-50/50">
              <div className="flex flex-wrap gap-2">
                <select className={inp} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">— supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className={inp} type="date" value={delDate} onChange={e => setDelDate(e.target.value)} />
                <input className={inp} placeholder="Delivery location" value={delLoc} onChange={e => setDelLoc(e.target.value)} />
              </div>
              {supplierId && (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-400"><th className="py-1">Item</th><th className="py-1 w-24">To order</th><th className="py-1 w-28">Order qty</th></tr></thead>
                  <tbody>
                    {supplierItems.map(i => (
                      <tr key={i.id}><td className="py-1">{i.name}</td><td className="py-1 text-gray-500">{i.remainingQty}</td>
                        <td className="py-1"><input className="w-24 border border-gray-200 rounded px-2 py-1" type="number" max={i.remainingQty} value={orderQty[i.id] ?? ''} onChange={e => setOrderQty(p => ({ ...p, [i.id]: e.target.value }))} placeholder="0" /></td></tr>
                    ))}
                    {supplierItems.length === 0 && <tr><td colSpan={3} className="py-2 text-gray-400">Nothing left to order for this supplier.</td></tr>}
                  </tbody>
                </table>
              )}
              <button onClick={issuePo} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm px-3.5 py-2 rounded-lg">Issue PO</button>
            </div>
          )}
        </div>
      )}

      {/* PO list */}
      {pos.length > 0 && (
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <h3 className="text-sm font-medium text-gray-800">Purchase orders ({pos.length})</h3>
          {pos.map(po => (
            <div key={po.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm">
                  <span className="font-medium">{po.poNumber}</span>
                  <span className="text-gray-400"> · {po.supplierName} · {po.status.replace('_', ' ')}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <a href={`/api/tenders/${tenderId}/supplier-po/${po.id}/pdf`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">PDF</a>
                  {canIssue && !po.ackDate && <button onClick={() => call(`/api/tenders/${tenderId}/supplier-po`, { supplierPoId: po.id, ack: true }, 'PATCH')} disabled={busy} className="text-gray-500 hover:text-gray-800">mark acknowledged</button>}
                  {canIssue && po.status !== 'closed' && <button onClick={() => call(`/api/tenders/${tenderId}/supplier-po`, { supplierPoId: po.id, close: true }, 'PATCH')} disabled={busy} className="text-gray-400 hover:text-red-500">close PO</button>}
                  {canReceive && po.status !== 'closed' && <button onClick={() => { setGrnFor(grnFor === po.id ? null : po.id); setRecv({}) }} className="text-green-600 hover:underline">{grnFor === po.id ? 'cancel' : 'receive goods'}</button>}
                </div>
              </div>
              {/* GRN form */}
              {grnFor === po.id && canReceive && (
                <div className="mt-2 border-t border-gray-50 pt-2">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-gray-400"><th className="py-1">Item</th><th className="py-1 w-20">Ordered</th><th className="py-1 w-20">Received</th><th className="py-1 w-28">Receive now</th></tr></thead>
                    <tbody>
                      {po.lines.map(l => (
                        <tr key={l.id}><td className="py-1">{l.itemName}</td><td className="py-1 text-gray-500">{l.qty}</td><td className="py-1 text-gray-500">{l.received}</td>
                          <td className="py-1"><input className="w-24 border border-gray-200 rounded px-2 py-1" type="number" value={recv[l.id] ?? ''} onChange={e => setRecv(p => ({ ...p, [l.id]: e.target.value }))} placeholder="0" /></td></tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={() => saveGrn(po)} disabled={busy} className="mt-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-lg">Record GRN</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Close tender */}
      {canClose && (
        <div className="border-t border-gray-100 pt-4">
          <button onClick={() => { if (confirm('Close this tender? Open POs will remain visible but no further actions are expected.')) call(`/api/tenders/${tenderId}/close`, { status: 'won' }) }} disabled={busy} className="border border-gray-300 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg">Close tender</button>
        </div>
      )}
    </section>
  )
}
