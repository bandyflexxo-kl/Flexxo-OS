'use client'

import { useEffect, useRef, useState } from 'react'

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
  const [prefs,     setPrefs]     = useState<Pref[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState<string | null>(null)
  const [showForm,  setShowForm]  = useState(false)
  const [editing,   setEditing]   = useState<Pref | null>(null)
  const [form,      setForm]      = useState<FormState>(EMPTY_FORM)
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [bulkBusy,  setBulkBusy]  = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const res  = await fetch('/api/admin/brand-preferences')
    const data = await res.json() as { prefs?: Pref[]; error?: string }
    setPrefs(data.prefs ?? [])
    setSelected(new Set())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  // Keep indeterminate state on select-all checkbox
  useEffect(() => {
    if (!selectAllRef.current) return
    const allIds = prefs.map(p => p.id)
    const n      = allIds.filter(id => selected.has(id)).length
    selectAllRef.current.indeterminate = n > 0 && n < prefs.length
    selectAllRef.current.checked       = prefs.length > 0 && n === prefs.length
  }, [selected, prefs])

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3500)
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allIds = prefs.map(p => p.id)
    const allSelected = allIds.every(id => selected.has(id))
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async function bulkSetActive(active: boolean) {
    setBulkBusy(true)
    await Promise.all([...selected].map(id =>
      fetch(`/api/admin/brand-preferences/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ isActive: active }),
      })
    ))
    setBulkBusy(false)
    flash(`${selected.size} rule${selected.size > 1 ? 's' : ''} ${active ? 'activated' : 'archived'}`)
    void load()
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} selected rule${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkBusy(true)
    await Promise.all([...selected].map(id =>
      fetch(`/api/admin/brand-preferences/${id}`, { method: 'DELETE' })
    ))
    setBulkBusy(false)
    flash(`${selected.size} rule${selected.size > 1 ? 's' : ''} deleted`)
    void load()
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────

  async function handleDuplicate(pref: Pref) {
    const body = {
      label:           `${pref.label} (copy)`,
      keywords:        pref.keywords,
      brands:          pref.brands,
      boostMultiplier: Number(pref.boostMultiplier),
      isActive:        false,  // duplicates start inactive so you edit before enabling
    }
    const res = await fetch('/api/admin/brand-preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(body),
    })
    if (res.ok) { flash('Duplicated — edit the copy and activate when ready'); void load() }
    else { setError('Duplicate failed') }
  }

  // ── Load defaults ─────────────────────────────────────────────────────────

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

  // ── Create / Edit form ────────────────────────────────────────────────────

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

  const hasSelection = selected.size > 0

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-5">

      {/* ── Header ── */}
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

      {/* ── Toasts ── */}
      {success && <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg border border-green-200">{success}</div>}
      {error   && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg border border-red-200">{error}</div>}

      {/* ── Bulk action bar (appears when rows selected) ── */}
      {hasSelection && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-800">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={() => bulkSetActive(true)}
            disabled={bulkBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            Activate
          </button>
          <button
            onClick={() => bulkSetActive(false)}
            disabled={bulkBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-40 transition-colors"
          >
            Archive
          </button>
          <button
            onClick={bulkDelete}
            disabled={bulkBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-400 hover:text-gray-600 ml-1"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Add / Edit form ── */}
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
                Trigger Keywords <span className="text-gray-400">(comma-separated)</span>
              </label>
              <input
                value={form.keywords}
                onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                placeholder="e.g. eraser  OR  glue,stick"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">All keywords must appear in the query to activate.</p>
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
                type="number" min="1.0" max="5.0" step="0.1"
                value={form.boostMultiplier}
                onChange={e => setForm(f => ({ ...f, boostMultiplier: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">1.6 = 60% boost. Stacks with stock boost (×1.35).</p>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                id="isActive" type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button
                type="submit" disabled={saving}
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
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    onChange={toggleAll}
                    className="rounded border-gray-300 cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Label</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Keywords</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Preferred Brands</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Boost</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600">Active</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prefs.map(pref => {
                const isSelected = selected.has(pref.id)
                return (
                  <tr
                    key={pref.id}
                    className={`transition-colors hover:bg-gray-50 ${!pref.isActive ? 'opacity-50' : ''} ${isSelected ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
                  >
                    <td className="pl-4 pr-2 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(pref.id)}
                        className="rounded border-gray-300 cursor-pointer"
                      />
                    </td>
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
                      <button onClick={() => handleToggle(pref)} className="text-lg leading-none" title={pref.isActive ? 'Click to deactivate' : 'Click to activate'}>
                        {pref.isActive ? '✅' : '⬜'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(pref)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </button>
                        <span className="text-gray-200">|</span>
                        <button
                          onClick={() => handleDuplicate(pref)}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                          title="Duplicate as inactive copy"
                        >
                          Duplicate
                        </button>
                        <span className="text-gray-200">|</span>
                        <button
                          onClick={() => handleDelete(pref.id, pref.label)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Row count footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
            {prefs.length} rule{prefs.length !== 1 ? 's' : ''}
            {hasSelection && <span className="ml-2 text-blue-600 font-medium">· {selected.size} selected</span>}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 space-y-1">
        <p><strong>How it works:</strong> When all trigger keywords appear in a Smart Order item query, products from the preferred brands get their score multiplied by the boost factor.</p>
        <p><strong>Example:</strong> Keywords <code className="bg-gray-100 px-1 rounded">glue,stick</code> → "Glue Stick 12pcs" → UHU or Chunbe scores ×1.6 higher.</p>
        <p><strong>Duplicate:</strong> Creates an inactive copy so you can adjust keywords/brands before enabling. <strong>Archive:</strong> Deactivates without deleting — rule stays but no longer applies.</p>
      </div>
    </div>
  )
}
