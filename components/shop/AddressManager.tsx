'use client'

/**
 * AddressManager — dashboard CRUD for a company's delivery branches.
 * Each address is a branch (branch name + contact person + phone + lat/lng).
 * Used on /shop/account (above password reset). Talks to /api/portal/addresses.
 */

import { useEffect, useState } from 'react'

type Addr = {
  id: string
  branchName: string | null
  contactPerson: string | null
  label: string | null
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  phone: string | null
  lat: string | null
  lng: string | null
  isDefault: boolean
}

type FormState = {
  branchName: string; contactPerson: string; phone: string
  line1: string; line2: string; postcode: string; city: string; state: string
  lat: string; lng: string; makeDefault: boolean
}

const EMPTY: FormState = {
  branchName: '', contactPerson: '', phone: '',
  line1: '', line2: '', postcode: '', city: '', state: '',
  lat: '', lng: '', makeDefault: false,
}

const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-400'

export default function AddressManager() {
  const [addresses, setAddresses] = useState<Addr[]>([])
  const [loading,   setLoading]   = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)   // null = none, 'new' = adding
  const [form,      setForm]      = useState<FormState>({ ...EMPTY })
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState<string | null>(null)
  const [geoBusy,   setGeoBusy]   = useState(false)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/portal/addresses').then(x => x.json()).catch(() => ({ addresses: [] }))
    setAddresses(Array.isArray(r.addresses) ? r.addresses : [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  function startAdd() { setForm({ ...EMPTY }); setEditingId('new'); setErr(null) }
  function startEdit(a: Addr) {
    setForm({
      branchName: a.branchName ?? '', contactPerson: a.contactPerson ?? '', phone: a.phone ?? '',
      line1: a.line1 ?? '', line2: a.line2 ?? '', postcode: a.postcode ?? '', city: a.city ?? '', state: a.state ?? '',
      lat: a.lat ?? '', lng: a.lng ?? '', makeDefault: a.isDefault,
    })
    setEditingId(a.id); setErr(null)
  }
  function cancel() { setEditingId(null); setErr(null) }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setErr('Geolocation is not supported on this device.'); return }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setForm(f => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })); setGeoBusy(false) },
      ()  => { setErr('Could not get your location — enter it manually or skip.'); setGeoBusy(false) },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function save() {
    setErr(null)
    if (form.line1.trim().length < 3) { setErr('Address line 1 is required.'); return }
    setSaving(true)
    try {
      const isNew  = editingId === 'new'
      const body   = isNew ? form : { ...form, id: editingId }
      const r      = await fetch('/api/portal/addresses', {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(typeof d.error === 'string' ? d.error : 'Could not save the address.'); return }
      setEditingId(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this delivery address?')) return
    const r = await fetch(`/api/portal/addresses?id=${id}`, { method: 'DELETE' })
    if (r.ok) await load()
  }

  async function makeDefault(id: string) {
    const a = addresses.find(x => x.id === id)
    if (!a) return
    await fetch('/api/portal/addresses', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, line1: a.line1 ?? '', branchName: a.branchName ?? '', contactPerson: a.contactPerson ?? '', phone: a.phone ?? '', line2: a.line2 ?? '', postcode: a.postcode ?? '', city: a.city ?? '', state: a.state ?? '', lat: a.lat ?? '', lng: a.lng ?? '', makeDefault: true }),
    })
    await load()
  }

  const fmt = (a: Addr) => [a.line1, a.line2, a.postcode, a.city, a.state].filter(Boolean).join(', ')

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Delivery Addresses</h3>
          <p className="text-xs text-gray-400 mt-0.5">Branches you can deliver to — pick one at checkout.</p>
        </div>
        {editingId === null && (
          <button onClick={startAdd} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors">
            + Add address
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2.5">
          {addresses.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-xl p-3">
              {editingId === a.id ? (
                <AddressFields form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} err={err} onGeo={useCurrentLocation} geoBusy={geoBusy} />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {a.branchName || a.label || 'Delivery address'}
                      {a.isDefault && <span className="ml-2 text-[10px] text-green-600 font-semibold">DEFAULT</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmt(a)}</p>
                    {(a.contactPerson || a.phone) && (
                      <p className="text-xs text-gray-400 mt-0.5">{[a.contactPerson, a.phone].filter(Boolean).join(' · ')}</p>
                    )}
                    {a.lat && a.lng && <p className="text-[10px] text-gray-300 mt-0.5">📍 {a.lat}, {a.lng}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button onClick={() => startEdit(a)} className="text-xs text-green-600 hover:underline">Edit</button>
                    {!a.isDefault && <button onClick={() => makeDefault(a.id)} className="text-xs text-gray-400 hover:text-gray-600">Set default</button>}
                    {!a.isDefault && <button onClick={() => remove(a.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {editingId === 'new' && (
            <div className="border border-green-200 rounded-xl p-3 bg-green-50/40">
              <AddressFields form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} err={err} onGeo={useCurrentLocation} geoBusy={geoBusy} />
            </div>
          )}

          {addresses.length === 0 && editingId === null && (
            <p className="text-sm text-gray-400">No delivery addresses yet. Add your first branch.</p>
          )}
        </div>
      )}
    </div>
  )
}

function AddressFields({ form, setForm, onSave, onCancel, saving, err, onGeo, geoBusy }: {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  onSave: () => void
  onCancel: () => void
  saving: boolean
  err: string | null
  onGeo: () => void
  geoBusy: boolean
}) {
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={form.branchName} onChange={set('branchName')} placeholder="Branch name (e.g. Flexxo KL)" className={input} />
        <input value={form.contactPerson} onChange={set('contactPerson')} placeholder="Contact person" className={input} />
      </div>
      <input value={form.phone} onChange={set('phone')} placeholder="Contact number" className={input} />
      <input value={form.line1} onChange={set('line1')} placeholder="Address line 1 *" className={input} />
      <input value={form.line2} onChange={set('line2')} placeholder="Address line 2" className={input} />
      <div className="grid grid-cols-3 gap-2">
        <input value={form.postcode} onChange={set('postcode')} placeholder="Postcode" className={input} />
        <input value={form.city} onChange={set('city')} placeholder="City" className={input} />
        <input value={form.state} onChange={set('state')} placeholder="State" className={input} />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onGeo} disabled={geoBusy} className="text-xs text-green-600 border border-green-200 rounded-lg px-2.5 py-1.5 hover:bg-green-50 disabled:opacity-50">
          {geoBusy ? 'Locating…' : '📍 Use current location'}
        </button>
        {form.lat && form.lng && <span className="text-[11px] text-gray-400">{form.lat}, {form.lng}</span>}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={form.makeDefault} onChange={e => setForm(f => ({ ...f, makeDefault: e.target.checked }))} className="rounded border-gray-300 text-green-600" />
        Set as default delivery address
      </label>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save address'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  )
}
