'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Ref = { id: string; name: string }

type ItemRow = {
  name:        string
  unit:        string
  qty:         string
  targetPrice: string
  confidence:  number   // 1 = manually entered
}

function blankRow(): ItemRow {
  return { name: '', unit: '', qty: '1', targetPrice: '', confidence: 1 }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500'
const label = 'block text-xs font-medium text-gray-500 mb-1'

export default function NewTenderForm({ suppliers, companies }: { suppliers: Ref[]; companies: Ref[] }) {
  const router = useRouter()

  // Header fields
  const [name, setName]               = useState('')
  const [category, setCategory]       = useState('')
  const [mode, setMode]               = useState<'multi' | 'single'>('multi')
  const [clientCompanyId, setClient]  = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd]     = useState('')
  const [submissionExpiry, setExpiry] = useState('')
  const [expectedPo, setExpectedPo]   = useState('')
  const [estValue, setEstValue]       = useState('')
  const [minQuotes, setMinQuotes]     = useState('')
  const [competitorNotes, setCompNotes] = useState('')
  const [internalRemarks, setRemarks] = useState('')

  // Items
  const [items, setItems] = useState<ItemRow[]>([blankRow()])

  // Vendor invites
  const [vendorIds, setVendorIds] = useState<Set<string>>(new Set())
  const [vendorSearch, setVendorSearch] = useState('')

  // AI scan
  const [pasteText, setPasteText] = useState('')
  const [scanning, setScanning]   = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addRow()   { setItems(prev => [...prev, blankRow()]) }
  function delRow(i: number) { setItems(prev => prev.filter((_, j) => j !== i)) }

  function applyScan(result: {
    items: { name: string; unit: string | null; qty: number | null; targetPrice: number | null; confidence: number }[]
    tenderName: string | null; submissionDeadline: string | null
  }) {
    if (result.tenderName && !name) setName(result.tenderName)
    if (result.submissionDeadline && !submissionExpiry) setExpiry(result.submissionDeadline)
    const rows: ItemRow[] = result.items.map(it => ({
      name:        it.name,
      unit:        it.unit ?? '',
      qty:         it.qty != null ? String(it.qty) : '1',
      targetPrice: it.targetPrice != null ? String(it.targetPrice) : '',
      confidence:  it.confidence,
    }))
    if (rows.length) {
      // Replace empty starter row, otherwise append
      setItems(prev => {
        const existing = prev.filter(r => r.name.trim() !== '')
        return [...existing, ...rows]
      })
    }
  }

  async function runScan(kind: 'pdf' | 'image' | 'text', data: string, mimeType?: string) {
    setScanning(true); setScanError(null)
    try {
      const res = await fetch('/api/tenders/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, data, mimeType }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Scan failed')
      applyScan(json)
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const b64 = await fileToBase64(file)
    if (file.type === 'application/pdf') await runScan('pdf', b64)
    else if (file.type.startsWith('image/')) await runScan('image', b64, file.type)
    else setScanError('Unsupported file type — upload a PDF or image, or paste text.')
  }

  async function submit() {
    setSubmitError(null)
    const cleanItems = items
      .filter(r => r.name.trim() !== '')
      .map(r => ({
        name:        r.name.trim(),
        unit:        r.unit.trim() || null,
        qty:         Number(r.qty) || 0,
        targetPrice: r.targetPrice.trim() ? Number(r.targetPrice) : null,
      }))
    if (!name.trim())       { setSubmitError('Tender name is required.'); return }
    if (cleanItems.length === 0) { setSubmitError('Add at least one item.'); return }
    if (cleanItems.some(i => i.qty <= 0)) { setSubmitError('Every item needs a quantity greater than 0.'); return }

    const toIso = (v: string) => (v ? new Date(v).toISOString() : null)

    setSubmitting(true)
    try {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim() || null,
          mode,
          clientCompanyId: clientCompanyId || null,
          periodStart: toIso(periodStart),
          periodEnd: toIso(periodEnd),
          submissionExpiry: toIso(submissionExpiry),
          expectedClientPoDate: toIso(expectedPo),
          estValue: estValue.trim() ? Number(estValue) : null,
          minQuotesRequired: minQuotes.trim() ? Number(minQuotes) : null,
          competitorNotes: competitorNotes.trim() || null,
          internalRemarks: internalRemarks.trim() || null,
          items: cleanItems,
          vendorSupplierIds: [...vendorIds],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not create tender. Check the fields.')
      router.push(`/tenders/${json.id}`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not create tender.')
      setSubmitting(false)
    }
  }

  const filteredSuppliers = vendorSearch.trim()
    ? suppliers.filter(s => s.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    : suppliers

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Details ───────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Tender details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>Tender name *</label>
            <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Supply of office stationery — Q3 2026" />
          </div>
          <div>
            <label className={label}>Category</label>
            <input className={input} value={category} onChange={e => setCategory(e.target.value)} placeholder="supply of goods, civil…" />
          </div>
          <div>
            <label className={label}>Sourcing mode</label>
            <select className={input} value={mode} onChange={e => setMode(e.target.value as 'multi' | 'single')}>
              <option value="multi">Multi-supplier (award per item)</option>
              <option value="single">Single supplier (whole tender)</option>
            </select>
          </div>
          <div>
            <label className={label}>Client company</label>
            <select className={input} value={clientCompanyId} onChange={e => setClient(e.target.value)}>
              <option value="">— none / not in CMS —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Estimated value (RM)</label>
            <input className={input} type="number" value={estValue} onChange={e => setEstValue(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={label}>Tender period start</label>
            <input className={input} type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <label className={label}>Tender period end</label>
            <input className={input} type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
          <div>
            <label className={label}>Submission expiry</label>
            <input className={input} type="date" value={submissionExpiry} onChange={e => setExpiry(e.target.value)} />
          </div>
          <div>
            <label className={label}>Expected client PO date</label>
            <input className={input} type="date" value={expectedPo} onChange={e => setExpectedPo(e.target.value)} />
          </div>
          <div>
            <label className={label}>Min. supplier quotes (optional)</label>
            <input className={input} type="number" value={minQuotes} onChange={e => setMinQuotes(e.target.value)} placeholder="e.g. 3" />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Competitor awareness notes</label>
            <input className={input} value={competitorNotes} onChange={e => setCompNotes(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Internal remarks</label>
            <textarea className={input} rows={2} value={internalRemarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        </div>
      </section>

      {/* ── AI scan ───────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">✨ Extract items from client document</h2>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={onFile} disabled={scanning} />
            Upload PDF / image
          </label>
        </div>
        <textarea
          className={input}
          rows={3}
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder="…or paste the item list / tender text here, then click Extract"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => runScan('text', pasteText)}
            disabled={scanning || !pasteText.trim()}
            className="bg-gray-900 hover:bg-black disabled:opacity-40 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            {scanning ? 'Scanning…' : 'Extract from text'}
          </button>
          {scanning && <span className="text-xs text-gray-400">Reading document with AI…</span>}
          {scanError && <span className="text-xs text-red-600">{scanError}</span>}
        </div>
        <p className="text-xs text-gray-400">Low-confidence rows are highlighted — review every line before saving. Nothing is saved until you click Create.</p>
      </section>

      {/* ── Items ─────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Item schedule</h2>
          <button type="button" onClick={addRow} className="text-sm font-medium text-blue-600 hover:text-blue-700">+ Add row</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Item name *</th>
                <th className="py-2 pr-2 w-24">Unit</th>
                <th className="py-2 pr-2 w-24">Qty *</th>
                <th className="py-2 pr-2 w-32">Target price</th>
                <th className="py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const low = r.confidence < 0.6
                return (
                  <tr key={i} className={low ? 'bg-yellow-50' : ''}>
                    <td className="py-1 pr-2 text-gray-400">
                      {i + 1}
                      {low && <span title="Low AI confidence — please verify" className="ml-1 text-yellow-500">●</span>}
                    </td>
                    <td className="py-1 pr-2"><input className={input} value={r.name} onChange={e => setItem(i, { name: e.target.value, confidence: 1 })} /></td>
                    <td className="py-1 pr-2"><input className={input} value={r.unit} onChange={e => setItem(i, { unit: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className={input} type="number" value={r.qty} onChange={e => setItem(i, { qty: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input className={input} type="number" value={r.targetPrice} onChange={e => setItem(i, { targetPrice: e.target.value })} placeholder="—" /></td>
                    <td className="py-1 text-center">
                      <button type="button" onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500" title="Remove">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Vendors ───────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Invite vendors <span className="text-gray-400 font-normal">({vendorIds.size} selected · optional)</span></h2>
        <input className={input} value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} placeholder="Search suppliers…" />
        <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
          {filteredSuppliers.slice(0, 200).map(s => (
            <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={vendorIds.has(s.id)}
                onChange={e => setVendorIds(prev => {
                  const n = new Set(prev)
                  if (e.target.checked) n.add(s.id); else n.delete(s.id)
                  return n
                })}
              />
              {s.name}
            </label>
          ))}
          {filteredSuppliers.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No suppliers match.</p>}
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {submitting ? 'Creating…' : 'Create tender'}
        </button>
        <button type="button" onClick={() => router.push('/tenders')} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
        {submitError && <span className="text-sm text-red-600">{submitError}</span>}
      </div>
      <p className="text-xs text-gray-400 -mt-2">On create, the tender opens at <strong>Gate 1</strong> — your Sales Manager must acknowledge it before the RFQ can be sent.</p>
    </div>
  )
}
