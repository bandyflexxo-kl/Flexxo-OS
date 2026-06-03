'use client'

import { useState } from 'react'
import Link from 'next/link'
import Modal from '@/components/ui/Modal'

type Supplier = {
  id:                string
  name:              string
  paymentTerm:       string | null
  currency:          string
  isActive:          boolean
  priceFileCount:    number
  priceVersionCount: number
}

export default function SuppliersTable({
  suppliers: initialSuppliers,
}: {
  suppliers: Supplier[]
}) {
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [showNew,   setShowNew]   = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState<string | null>(null)

  // New supplier form
  const [form, setForm] = useState({ name: '', paymentTerm: '', currency: 'MYR' })

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  async function createSupplier() {
    if (!form.name.trim()) { setError('Supplier name is required.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/suppliers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: form.name, paymentTerm: form.paymentTerm || undefined, currency: form.currency }),
      })
      const data = await res.json() as Supplier & { error?: unknown }
      if (!res.ok) { setError('Failed to create supplier.'); return }
      setSuppliers(prev => [...prev, { ...data, priceFileCount: 0, priceVersionCount: 0 }])
      setShowNew(false)
      setForm({ name: '', paymentTerm: '', currency: 'MYR' })
      flash(`Supplier "${data.name}" created`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{success}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Supplier
        </button>
      </div>

      {suppliers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
          No suppliers yet. Add your first supplier to get started.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Payment Term</th>
                <th className="px-4 py-3 font-medium">Currency</th>
                <th className="px-4 py-3 font-medium">Price Files</th>
                <th className="px-4 py-3 font-medium">Price Items</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.paymentTerm ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.currency}</td>
                  <td className="px-4 py-3 text-gray-700">{s.priceFileCount}</td>
                  <td className="px-4 py-3 text-gray-700">{s.priceVersionCount}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <Modal
          title="Add Supplier"
          onClose={() => setShowNew(false)}
          actions={
            <>
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createSupplier}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create Supplier'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Supplier Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. ABC Trading Sdn Bhd"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Payment Term</label>
              <input
                type="text"
                value={form.paymentTerm}
                onChange={e => setForm(f => ({ ...f, paymentTerm: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 30 days, COD"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="MYR">MYR</option>
                <option value="USD">USD</option>
                <option value="SGD">SGD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
