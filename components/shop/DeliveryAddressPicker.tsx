'use client'

import { useEffect, useState } from 'react'

type Addr = {
  id: string; label: string | null; line1: string; line2: string | null
  city: string | null; state: string | null; postcode: string | null
  phone: string | null; isDefault: boolean
}

const EMPTY = { label: '', line1: '', line2: '', city: '', postcode: '', state: '', phone: '' }

/** Pick a saved company delivery address, or add a new one (lat/lng captured later). */
export default function DeliveryAddressPicker({
  value, onChange,
}: { value: string | null; onChange: (id: string | null) => void }) {
  const [addresses, setAddresses] = useState<Addr[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [form,      setForm]      = useState({ ...EMPTY })
  const [err,       setErr]       = useState<string | null>(null)

  async function load(selectId?: string) {
    const r = await fetch('/api/portal/addresses').then(x => x.json()).catch(() => ({ addresses: [] }))
    const list: Addr[] = r.addresses ?? []
    setAddresses(list)
    setLoading(false)
    const pick = selectId ?? (value ?? list.find(a => a.isDefault)?.id ?? list[0]?.id)
    if (pick) onChange(pick)
    if (list.length === 0) setShowForm(true)   // no addresses yet → open the form
  }
  useEffect(() => { void load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function saveNew() {
    if (form.line1.trim().length < 3) { setErr('Address line 1 is required.'); return }
    setSaving(true); setErr(null)
    const r = await fetch('/api/portal/addresses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    const d = await r.json()
    setSaving(false)
    if (!r.ok) { setErr(typeof d.error === 'string' ? d.error : 'Could not save the address.'); return }
    setForm({ ...EMPTY }); setShowForm(false)
    await load(d.address.id)
  }

  const fmt = (a: Addr) => [a.line1, a.line2, a.city, a.postcode, a.state].filter(Boolean).join(', ')
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500'

  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-2">📍 Deliver to</p>

      {loading ? (
        <p className="text-xs text-gray-400">Loading addresses…</p>
      ) : (
        <div className="space-y-2">
          {addresses.map(a => (
            <label key={a.id}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                value === a.id ? 'border-green-500 bg-green-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
              <input type="radio" name="delivery-address" checked={value === a.id}
                onChange={() => onChange(a.id)} className="mt-0.5 accent-green-600" />
              <span className="min-w-0">
                <span className="text-sm font-medium text-gray-900">
                  {a.label || 'Delivery address'}{a.isDefault && <span className="ml-1.5 text-[10px] text-green-600 font-semibold">DEFAULT</span>}
                </span>
                <span className="block text-xs text-gray-500">{fmt(a)}</span>
                {a.phone && <span className="block text-xs text-gray-400">☎ {a.phone}</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}
          className="mt-2 text-xs font-medium text-green-600 hover:text-green-700">
          ➕ Add new delivery address
        </button>
      )}

      {showForm && (
        <div className="mt-3 rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/50">
          <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Label / recipient (e.g. HQ Store, Mr Lee)" className={inputCls} />
          <input value={form.line1} onChange={e => setForm(f => ({ ...f, line1: e.target.value }))} placeholder="Address line 1 *" className={inputCls} />
          <input value={form.line2} onChange={e => setForm(f => ({ ...f, line2: e.target.value }))} placeholder="Address line 2" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.postcode} onChange={e => setForm(f => ({ ...f, postcode: e.target.value }))} placeholder="Postcode" className={inputCls} />
            <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="State" className={inputCls} />
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Delivery phone" className={inputCls} />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={saveNew} disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save address'}
            </button>
            {addresses.length > 0 && (
              <button type="button" onClick={() => { setShowForm(false); setErr(null) }}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
