'use client'

/**
 * /admin/customer-discounts — customer-level discount listing + inline edit (B7/#9).
 * Shows every portal customer and the standing discount % applied to their quotes.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Row = { id: string; name: string; discountPct: number }

export default function CustomerDiscountsPage() {
  const [rows,    setRows]    = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [draft,   setDraft]   = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/customer-discounts').then(x => x.json()).catch(() => ({ companies: [] }))
    setRows(Array.isArray(r.companies) ? r.companies : [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function save(id: string) {
    const raw = draft[id]
    const pct = Number(raw)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { setError('Enter a % between 0 and 100.'); return }
    setError(null); setSaving(id)
    try {
      const r = await fetch('/api/admin/customer-discounts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: id, discountPct: pct }),
      })
      if (!r.ok) { setError('Could not save.'); return }
      setRows(rs => rs.map(x => x.id === id ? { ...x, discountPct: pct } : x))
      setDraft(d => { const n = { ...d }; delete n[id]; return n })
      setSavedId(id); setTimeout(() => setSavedId(s => s === id ? null : s), 2000)
    } finally {
      setSaving(null)
    }
  }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
  const withDiscount = rows.filter(r => r.discountPct > 0).length

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Customer Discounts</h1>
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Admin</Link>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Standing discount % applied to each customer&apos;s quotes (on goods, excluding delivery). {withDiscount} of {rows.length} have a discount.
      </p>

      <input
        value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-green-400"
      />
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium text-right w-48">Discount %</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const editing = r.id in draft
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number" min={0} max={100} step={0.5}
                          value={editing ? draft[r.id] : String(r.discountPct)}
                          onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))}
                          className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-400"
                        />
                        <span className="text-gray-400 text-xs">%</span>
                        {editing && (
                          <button onClick={() => save(r.id)} disabled={saving === r.id}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                            {saving === r.id ? '…' : 'Save'}
                          </button>
                        )}
                        {savedId === r.id && <span className="text-xs text-green-600">✓</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
