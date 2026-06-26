'use client'

import { useEffect, useState } from 'react'

type Override = {
  id:        string
  brand:     string
  site:      string | null
  hint:      string | null
  updatedAt: string
}

export default function BrandSitesPage() {
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Add-form state
  const [addBrand,  setAddBrand]  = useState('')
  const [addSite,   setAddSite]   = useState('')
  const [addHint,   setAddHint]   = useState('')
  const [saving,    setSaving]    = useState(false)

  // Inline-edit state
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editSite,  setEditSite]  = useState('')
  const [editHint,  setEditHint]  = useState('')

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/brand-sites')
      const data = await res.json() as { overrides: Override[] }
      setOverrides(data.overrides)
    } catch { setError('Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function save(brand: string, site: string, hint: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/brand-sites', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ brand, site: site || null, hint: hint || null }),
      })
      if (!res.ok) { setError('Save failed'); return }
      setAddBrand(''); setAddSite(''); setAddHint('')
      setEditId(null)
      await load()
    } catch { setError('Save failed') }
    finally { setSaving(false) }
  }

  async function del(brand: string) {
    await fetch(`/api/admin/brand-sites/${encodeURIComponent(brand)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Brand Site Overrides</h1>
        <p className="text-sm text-gray-500 mt-1">
          Maps a brand name to its official website and optional search hint.
          Used automatically by Re-scrape and AI Web Search when resolving flagged photos.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Add row */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Add / update override</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Brand name</label>
            <input
              type="text"
              value={addBrand}
              onChange={e => setAddBrand(e.target.value.toUpperCase())}
              placeholder="e.g. KIM KONG"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Official website</label>
            <input
              type="text"
              value={addSite}
              onChange={e => setAddSite(e.target.value.toLowerCase())}
              placeholder="e.g. everlas.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Search hint (optional)</label>
            <input
              type="text"
              value={addHint}
              onChange={e => setAddHint(e.target.value)}
              placeholder="e.g. heavy duty double sided ladder"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <button
          onClick={() => void save(addBrand, addSite, addHint)}
          disabled={!addBrand.trim() || saving}
          className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save override'}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : overrides.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">No overrides yet. Add one above.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Brand</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">Site</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hint</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Updated</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overrides.map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-900">{o.brand}</td>
                  <td className="px-4 py-3">
                    {editId === o.id ? (
                      <input
                        type="text"
                        value={editSite}
                        onChange={e => setEditSite(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <span className={`font-mono text-xs ${o.site ? 'text-blue-600' : 'text-gray-300 italic'}`}>
                        {o.site ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editId === o.id ? (
                      <input
                        type="text"
                        value={editHint}
                        onChange={e => setEditHint(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <span className={`text-xs ${o.hint ? 'text-gray-700' : 'text-gray-300 italic'}`}>
                        {o.hint ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(o.updatedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    {editId === o.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void save(o.brand, editSite, editHint)}
                          disabled={saving}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-xs px-2 py-1 text-gray-500 hover:bg-gray-100 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditId(o.id); setEditSite(o.site ?? ''); setEditHint(o.hint ?? '') }}
                          className="text-xs px-2 py-1 text-gray-500 hover:bg-gray-100 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void del(o.brand)}
                          className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
