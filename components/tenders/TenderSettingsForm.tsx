'use client'

import { useState } from 'react'

type Settings = {
  varianceThreshold: number
  minQuotesDefault:  number | null
  qneWritesEnabled:  boolean
}

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500'

export default function TenderSettingsForm({ initial }: { initial: Settings }) {
  const [variance, setVariance] = useState(String(initial.varianceThreshold))
  const [minQuotes, setMinQuotes] = useState(initial.minQuotesDefault != null ? String(initial.minQuotesDefault) : '')
  const [qneWrites, setQneWrites] = useState(initial.qneWritesEnabled)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const res = await fetch('/api/admin/tender-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          varianceThreshold: Number(variance),
          minQuotesDefault:  minQuotes.trim() ? Number(minQuotes) : null,
          qneWritesEnabled:  qneWrites,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not save')
      setMsg('Saved.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-800">Variance threshold (%)</label>
        <p className="text-xs text-gray-400 mb-1.5">Supplier quotes above this % over the normal price list are flagged in evaluation. Override per tender is possible.</p>
        <input className={input} type="number" step="0.5" value={variance} onChange={e => setVariance(e.target.value)} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-800">Default minimum supplier quotes</label>
        <p className="text-xs text-gray-400 mb-1.5">Default for new tenders. Leave blank for no minimum. Can be changed per tender.</p>
        <input className={input} type="number" value={minQuotes} onChange={e => setMinQuotes(e.target.value)} placeholder="(none)" />
      </div>

      <div className="flex items-start gap-3 border-t border-gray-100 pt-4">
        <input id="qne" type="checkbox" className="mt-0.5" checked={qneWrites} onChange={e => setQneWrites(e.target.checked)} />
        <label htmlFor="qne" className="text-sm">
          <span className="font-medium text-gray-800">Enable QNE writes (PO / GRN)</span>
          <p className="text-xs text-gray-400 mt-0.5">Off until a procurement-permissioned QNE account is provisioned. When on, supplier POs and GRNs mirror to QNE (still requires double approval per write).</p>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  )
}
