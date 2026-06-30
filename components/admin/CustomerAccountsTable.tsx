'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'

type CustomerAccount = {
  id:                string
  name:              string
  email:             string
  isActive:          boolean
  lastLoginAt:       string | null
  customerCompanyId: string | null
  customerCompany:   { id: string; name: string } | null
}

type Company = {
  id:   string
  name: string
}

type Prefill = { name?: string; email?: string; companyName?: string } | null

export default function CustomerAccountsTable({
  accounts:  initialAccounts,
  companies,
  prefill = null,
}: {
  accounts:  CustomerAccount[]
  companies: Company[]
  prefill?:  Prefill
}) {
  const [accounts, setAccounts] = useState(initialAccounts)
  // Open new-account form automatically when prefill data is present
  const [showNew,  setShowNew]  = useState(!!prefill)
  const [busy,     setBusy]     = useState<Set<string>>(new Set())
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState<string | null>(null)
  const [warning,  setWarning]  = useState<string | null>(null)

  const [form, setForm] = useState({
    name:      prefill?.name      ?? '',
    email:     prefill?.email     ?? '',
    password:  '',
    companyId: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  async function createAccount() {
    if (!form.name || !form.email || !form.password || !form.companyId) {
      setFormError('All fields are required.')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const res  = await fetch('/api/admin/customer-accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: form.name, email: form.email, password: form.password, customerCompanyId: form.companyId }),
      })
      const data = await res.json() as CustomerAccount & { emailSent?: boolean; error?: unknown }
      if (!res.ok) {
        setFormError(typeof data.error === 'string' ? data.error : 'Failed to create account.')
        return
      }
      const company = companies.find(c => c.id === form.companyId) ?? null
      setAccounts(prev => [...prev, {
        id:                data.id,
        name:              data.name,
        email:             data.email,
        isActive:          true,
        lastLoginAt:       null,
        customerCompanyId: form.companyId,
        customerCompany:   company ? { id: company.id, name: company.name } : null,
      }])
      setShowNew(false)
      setForm({ name: '', email: '', password: '', companyId: '' })
      setWarning(null)
      if (data.emailSent) {
        flash(`Portal account created — login details emailed to ${data.email}`)
      } else {
        // Account created, but the credentials email didn't go out — make it obvious
        // so the admin shares the login manually instead of assuming the email sent.
        setWarning(`Account created for ${data.name}, but the welcome email to ${data.email} could NOT be sent. Please share the login email + password with them directly.`)
      }
    } finally {
      setCreating(false)
    }
  }

  async function revokeAccess(account: CustomerAccount) {
    setBusy(prev => new Set([...prev, account.id]))
    setError(null)
    try {
      const res = await fetch(`/api/admin/customer-accounts/${account.id}`, { method: 'DELETE' })
      if (!res.ok) { setError('Failed to revoke access.'); return }
      setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, isActive: false } : a))
      flash(`Access revoked for ${account.name}`)
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(account.id); return n })
    }
  }

  return (
    <div className="space-y-4">
      {error   && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{success}</div>}
      {warning && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start justify-between gap-3">
          <span>⚠️ {warning}</span>
          <button onClick={() => setWarning(null)} className="text-amber-500 hover:text-amber-700 text-base leading-none shrink-0">×</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{accounts.length} portal account{accounts.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Create Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
          No customer portal accounts yet. Create one to give a client company access.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Login</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{a.email}</td>
                  <td className="px-4 py-3 text-gray-700 text-sm">{a.customerCompany?.name ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${a.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${a.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {a.isActive ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleDateString('en-MY') : <span className="italic">Never</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.isActive && (
                      <button
                        onClick={() => revokeAccess(a)}
                        disabled={busy.has(a.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                      >
                        {busy.has(a.id) ? '…' : 'Revoke Access'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <Modal
          title="Create Customer Portal Account"
          onClose={() => setShowNew(false)}
          actions={
            <>
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createAccount} disabled={creating} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Account'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. Ahmad bin Hassan" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email (login) *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. ahmad@company.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password *</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Min 8 characters" />
              <p className="text-xs text-gray-400 mt-1">Customer will be prompted to change on first login.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company *</label>
              <select value={form.companyId} onChange={e => setForm(f => ({ ...f, companyId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
                <option value="">— Select company —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {prefill?.companyName && !form.companyId && (
                <p className="text-xs text-amber-600 mt-1">
                  Requested company: <strong>{prefill.companyName}</strong> — find and select it above, or create a new company first.
                </p>
              )}
            </div>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
