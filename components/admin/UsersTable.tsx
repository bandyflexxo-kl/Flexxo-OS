'use client'

import { useState, useMemo } from 'react'
import Modal from '@/components/ui/Modal'

type UserRow = {
  id:                 string
  name:               string
  email:              string
  mobileNo:           string | null
  isActive:           boolean
  mustChangePassword: boolean
  lastLoginAt:        string | null
  role:               string
}

type Role = {
  id:   string
  name: string
}

export default function UsersTable({
  users:     initialUsers,
  roles,
  currentUserId,
}: {
  users:         UserRow[]
  roles:         Role[]
  currentUserId: string
}) {
  const [users,   setUsers]   = useState(initialUsers)
  const [busy,    setBusy]    = useState<Set<string>>(new Set())
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // ── Tab split: internal team vs customer (B2B Client) accounts ──────────
  const [tab,        setTab]        = useState<'internal' | 'customers'>('internal')
  const [roleFilter, setRoleFilter] = useState('')

  const internalUsers = useMemo(() => users.filter(u => u.role !== 'B2B Client'), [users])
  const customerUsers = useMemo(() => users.filter(u => u.role === 'B2B Client'), [users])

  // Role options present among internal users (for the filter dropdown)
  const internalRoles = useMemo(
    () => [...new Set(internalUsers.map(u => u.role))].sort(),
    [internalUsers]
  )

  const visibleUsers = useMemo(() => {
    if (tab === 'customers') return customerUsers
    return roleFilter ? internalUsers.filter(u => u.role === roleFilter) : internalUsers
  }, [tab, roleFilter, internalUsers, customerUsers])

  // Password modal state
  const [pwModal,   setPwModal]   = useState<UserRow | null>(null)
  const [pwValue,   setPwValue]   = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwError,   setPwError]   = useState<string | null>(null)

  // Role modal state
  const [roleModal,    setRoleModal]    = useState<UserRow | null>(null)
  const [selectedRole, setSelectedRole] = useState('')

  // Edit user (name + email + mobile) modal state
  const [editModal,      setEditModal]      = useState<UserRow | null>(null)
  const [editName,       setEditName]       = useState('')
  const [editEmail,      setEditEmail]      = useState('')
  const [editMobile,     setEditMobile]     = useState('')
  const [editError,      setEditError]      = useState<string | null>(null)

  function flash(msg: string) {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3500)
  }

  function setBusyId(id: string, on: boolean) {
    setBusy(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n })
  }

  async function toggleActive(user: UserRow) {
    setBusyId(user.id, true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ isActive: !user.isActive }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u))
      flash(`${user.name} ${!user.isActive ? 'activated' : 'deactivated'}`)
    } finally {
      setBusyId(user.id, false)
    }
  }

  async function savePassword() {
    if (!pwModal) return
    setPwError(null)
    if (pwValue.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (pwValue !== pwConfirm) { setPwError('Passwords do not match.'); return }

    setBusyId(pwModal.id, true)
    try {
      const res = await fetch(`/api/admin/users/${pwModal.id}/password`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: pwValue }),
      })
      const data = await res.json() as { error?: string; mustChangePassword?: boolean }
      if (!res.ok) { setPwError(data.error ?? 'Failed'); return }
      setUsers(prev => prev.map(u =>
        u.id === pwModal.id
          ? { ...u, mustChangePassword: data.mustChangePassword ?? false }
          : u
      ))
      flash(`Password set for ${pwModal.name}`)
      setPwModal(null)
      setPwValue('')
      setPwConfirm('')
    } finally {
      setBusyId(pwModal.id, false)
    }
  }

  async function saveEdit() {
    if (!editModal) return
    if (!editName.trim()) { setEditError('Name is required.'); return }
    if (!editEmail.trim()) { setEditError('Email is required.'); return }
    setBusyId(editModal.id, true)
    setEditError(null)
    try {
      const res = await fetch(`/api/admin/users/${editModal.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: editName.trim(), email: editEmail.trim(), mobileNo: editMobile.trim() || null }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setEditError(data.error ?? 'Failed to save'); return }
      setUsers(prev => prev.map(u =>
        u.id === editModal.id ? { ...u, name: editName.trim(), email: editEmail.trim(), mobileNo: editMobile.trim() || null } : u
      ))
      flash(`Updated ${editName.trim()}`)
      setEditModal(null)
    } finally {
      setBusyId(editModal.id, false)
    }
  }

  async function saveRole() {
    if (!roleModal || !selectedRole) return
    setBusyId(roleModal.id, true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${roleModal.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ roleId: selectedRole }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      const roleName = roles.find(r => r.id === selectedRole)?.name ?? roleModal.role
      setUsers(prev => prev.map(u => u.id === roleModal.id ? { ...u, role: roleName } : u))
      flash(`Role updated for ${roleModal.name}`)
      setRoleModal(null)
    } finally {
      setBusyId(roleModal.id, false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      {/* ── Tab bar: Internal Team / Customers + role filter ─────────── */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => { setTab('internal'); setRoleFilter('') }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === 'internal' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            👥 Internal Team
            <span className="ml-1.5 text-xs text-gray-400 tabular-nums">{internalUsers.length}</span>
          </button>
          <button
            onClick={() => { setTab('customers'); setRoleFilter('') }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === 'customers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🏢 Customers
            <span className="ml-1.5 text-xs text-gray-400 tabular-nums">{customerUsers.length}</span>
          </button>
        </div>

        {tab === 'internal' && (
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 text-gray-700"
          >
            <option value="">All Roles</option>
            {internalRoles.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}

        <span className="text-xs text-gray-400">
          {visibleUsers.length} user{visibleUsers.length !== 1 ? 's' : ''} shown
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Mobile</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Login</th>
              <th className="px-4 py-3 font-medium">Password</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                  No {tab === 'customers' ? 'customer accounts' : roleFilter ? `${roleFilter} users` : 'internal users'} found.
                </td>
              </tr>
            )}
            {visibleUsers.map(user => {
              const isBusy   = busy.has(user.id)
              const isSelf   = user.id === currentUserId
              const isInternal = user.email.endsWith('@flexxo.internal')

              return (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {user.name}
                    {isSelf && <span className="ml-2 text-xs text-blue-500">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{user.email}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{user.mobileNo ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'Admin'      ? 'bg-purple-100 text-purple-700' :
                      user.role === 'Manager'    ? 'bg-blue-100 text-blue-700' :
                      user.role === 'Salesperson'? 'bg-green-100 text-green-700' :
                                                   'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                      user.isActive ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
                      : <span className="italic">Never</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {user.mustChangePassword ? (
                      <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                        ⚠ Must change
                      </span>
                    ) : isInternal ? (
                      <span className="text-xs text-gray-400">Set</span>
                    ) : (
                      <span className="text-xs text-green-600">✓ OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditModal(user)
                          setEditName(user.name)
                          setEditEmail(user.email)
                          setEditMobile(user.mobileNo ?? '')
                          setEditError(null)
                        }}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setPwModal(user)
                          setPwValue('')
                          setPwConfirm('')
                          setPwError(null)
                        }}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                      >
                        Set Password
                      </button>
                      {!isSelf && (
                        <>
                          <button
                            onClick={() => {
                              setRoleModal(user)
                              setSelectedRole(roles.find(r => r.name === user.role)?.id ?? '')
                            }}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                          >
                            Role
                          </button>
                          <button
                            onClick={() => toggleActive(user)}
                            disabled={isBusy}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40 transition-colors ${
                              user.isActive
                                ? 'border-red-200 text-red-600 hover:bg-red-50'
                                : 'border-green-200 text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {isBusy ? '…' : user.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Set Password Modal */}
      {pwModal && (
        <Modal
          title={`Set password — ${pwModal.name}`}
          onClose={() => setPwModal(null)}
          actions={
            <>
              <button
                onClick={() => setPwModal(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={savePassword}
                disabled={busy.has(pwModal.id)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy.has(pwModal.id) ? 'Saving…' : 'Save password'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              The user will be prompted to change this password on their next login.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">New password</label>
              <input
                type="password"
                value={pwValue}
                onChange={e => setPwValue(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Minimum 8 characters"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                type="password"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePassword()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Repeat password"
              />
            </div>
            {pwError && <p className="text-xs text-red-600">{pwError}</p>}
          </div>
        </Modal>
      )}

      {/* Edit Name + Email Modal */}
      {editModal && (
        <Modal
          title={`Edit user — ${editModal.name}`}
          onClose={() => setEditModal(null)}
          actions={
            <>
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={busy.has(editModal.id)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy.has(editModal.id) ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email (login address)</label>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. justine@flexxo.com.my"
              />
              <p className="text-xs text-gray-400 mt-1">
                The salesperson will log in with this email address.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mobile / WhatsApp number</label>
              <input
                type="tel"
                value={editMobile}
                onChange={e => setEditMobile(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 0123456789"
              />
              <p className="text-xs text-gray-400 mt-1">
                Used for WhatsApp integration (Phase 2).
              </p>
            </div>
            {editError && <p className="text-xs text-red-600">{editError}</p>}
          </div>
        </Modal>
      )}

      {/* Change Role Modal */}
      {roleModal && (
        <Modal
          title={`Change role — ${roleModal.name}`}
          onClose={() => setRoleModal(null)}
          actions={
            <>
              <button
                onClick={() => setRoleModal(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRole}
                disabled={busy.has(roleModal.id) || !selectedRole}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {busy.has(roleModal.id) ? 'Saving…' : 'Save role'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Current role: <strong>{roleModal.role}</strong></p>
            <div className="space-y-2">
              {roles.map(role => (
                <label key={role.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="role"
                    value={role.id}
                    checked={selectedRole === role.id}
                    onChange={() => setSelectedRole(role.id)}
                    className="text-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-900">{role.name}</span>
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
