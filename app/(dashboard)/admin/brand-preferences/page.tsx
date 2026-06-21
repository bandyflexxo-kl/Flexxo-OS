'use client'

/**
 * /admin/brand-preferences
 * Manage product-type → preferred-brand rules for Smart Order matching.
 */

import { useEffect, useState } from 'react'

type Pref = {
  id:              string
  label:           string
  keywords:        string
  brands:          string
  boostMultiplier: number
  isActive:        boolean
  createdAt:       string
}

type FormState = {
  label:           string
  keywords:        string
  brands:          string
  boostMultiplier: string
  isActive:        boolean
}

const EMPTY_FORM: FormState = { label: '', keywords: '', brands: '', boostMultiplier: '1.6', isActive: true }

export default function BrandPreferencesPage() {
  const [prefs,    setPrefs]    = useState<Pref[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing,  setEditing]  = useState<Pref | null>(null)
  const [form,     setForm]     = useState<FormState>(EMPTY_FORM)

  async function load() {
    setLoading(true)
    const res  = await fetch('/api/admin/brand-preferences')
    const data = await res.json() as { prefs?: Pref[]; error?: string }
    setPrefs(data.prefs ?? [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  async function handleLoadDefaults() {
    if (!confirm('Load Flexxo default brand preferences? This only works if the list is empty.')) return
    setSaving(true)
    const res  = await fetch('/api/admin/brand-preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ loadDefaults: true }),
    })
    const data = await res.json() as { created?: number; error?: string }
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return }
    flash(`Loaded ${data.created} default preferences`)
    void load()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)

    const body = {
      label:           form.label.trim(),
      keywords:        form.keywords.trim(),
      brands:          form.brands.trim(),
      boostMultiplier: parseFloat(form.boostMultiplier) || 1.6,
      isActive:        form.isActive,
    }

    const url    = editing ? `/api/admin/brand-preferences/${editing.id}` : '/api/admin/brand-preferences'
    const method = editing ? 'PUT' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data   = await res.json() as { pref?: Pref; error?: string }

    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Save failed'); return }
    flash(editing ? 'Updated' : 'Created')
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    void load()
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    await fetch(`/api/admin/brand-preferences/${id}`, { method: 'DELETE' })
    void load()
  }

  async function handleToggle(pref: Pref) {
    await fetch(`/api/admin/brand-preferences/${pref.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ isActive: !pref.isActive }),
    })
    void load()
  }

  function openEdit(pref: Pref) {
    setEditing(pref)
    setForm({
      label:           pref.label,
      keywords:        pref.keywords,
      brands:          pref.brands,
      boostMultiplier: String(pref.boostMultiplier),
      isActive:        pref.isActive,
    })
    setShowForm(true)
    setError(null)
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setError(null)
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand Preferences</h1>
          <p className="text-sm text-gray-500 mt-1">
            Define which brands Smart Order prefers for each product type.
            e.g. "eraser" → Faber Castell gets ×1.6 boost over competitors.
          </p>
        </div>
        <div className="flex gap-2">
          {prefs.length === 0 && !loading && (
            <button
              onClick={handleLoadDefaults}
              disabled={saving}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Load Flexxo Defaults
            </button>
          )}
          <button
            onClick={openAdd}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            + Add Rule
          </button>
        </div>
      </div>

      {success && <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg border border-green-200">{success}</div>}
      {error   && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg border border-red-200">{error}</div>}

      {/* ── Form ── */}
      {showForm && (
        <div className="border border-blue-200 rounded-xl bg-blue-50 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">{editing ? 'Edit Rule' : 'New Rule'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Label (human-readable)</label>
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Eraser → Faber Castell"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Trigger Keywords <span className="text-gray-400">(comma-separated, all must match query)</span>
              </label>
              <input
                value={form.keywords}
                onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                placeholder="e.g. eraser  OR  glue,stick"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                All keywords must appear in the item query to activate the rule.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Preferred Brands <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                value={form.brands}
                onChange={e => setForm(f => ({ ...f, brands: e.target.value }))}
                placeholder="e.g. Faber Castell,Staedtler"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Boost Multiplier</label>
              <input
                type="number"
                min="1.0"
                max="5.0"
                step="0.1"
                value={form.boostMultiplier}
                onChange={e => setForm(f => ({ ...f, boostMultiplier: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">1.6 = 60% score boost. Stacked with stock boost (×1.35).</p>
            </div>

            <div className="flex items-center gap-2 pt-5">
              <input
                id="isActive"
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
            </div>

            <div className="col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditing(null); setError(null) }}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : prefs.length === 0 ? (
        <div className="py-12 text-center border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-sm text-gray-500 font-medium">No brand preferences configured.</p>
          <p className="text-xs text-gray-400 mt-1">Click "Load Flexxo Defaults" to add the 8 standard rules, or add manually.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Label</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Keywords</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Preferred Brands</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Boost</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Active</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prefs.map(pref => (
                <tr key={pref.id} className={`transition-colors hover:bg-gray-50 ${!pref.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{pref.label}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-blue-700">{pref.keywords}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{pref.brands}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                      ×{Number(pref.boostMultiplier).toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleToggle(pref)} className="text-lg">
                      {pref.isActive ? '✅' : '⬜'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => openEdit(pref)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(pref.id, pref.label)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-400 space-y-1">
        <p><strong>How it works:</strong> When all trigger keywords appear in a Smart Order item query, products from the preferred brands get their score multiplied by the boost factor.</p>
        <p><strong>Example:</strong> Keywords <code className="bg-gray-100 px-1 rounded">glue,stick</code> → if customer pastes "Glue Stick 12pcs", products from UHU or Chunbe score ×1.6 higher than competitors.</p>
        <p><strong>Stacking:</strong> Boost stacks with the stock boost (×1.35) already in effect. An in-stock preferred brand at rawScore 0.40 → 0.40 × 1.35 × 1.6 = 0.86.</p>
      </div>
    </div>
  )
}
