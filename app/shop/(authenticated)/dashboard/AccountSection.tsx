'use client'

import { useState } from 'react'

// ── Change Password ───────────────────────────────────────────────────────────

function ChangePasswordForm() {
  const [open,      setOpen]      = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState(false)
  const [pending,   setPending]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPw.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setError('Passwords do not match.'); return }

    setPending(true)
    try {
      const res  = await fetch('/api/portal/account', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Password change failed.'); return }
      setSuccess(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => { setOpen(false); setSuccess(false) }, 2000)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setError(null); setSuccess(false) }}
        className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">🔒</span>
          <span className="text-sm font-semibold text-gray-700">Change Password</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3">
          {success && (
            <div className="mb-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <span className="text-green-600 text-sm">✓</span>
              <p className="text-sm text-green-700 font-medium">Password updated successfully.</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                required autoComplete="current-password"
                className={inputCls + ' pr-10'}
                placeholder="Current password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 bottom-2.5 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPw ? 'Hide' : 'Show'}
              >
                {showPw ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                )}
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                required autoComplete="new-password"
                className={inputCls}
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required autoComplete="new-password"
                className={inputCls}
                placeholder="Repeat new password"
              />
            </div>

            {error && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {pending ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Sign Out ──────────────────────────────────────────────────────────────────

function SignOutCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">🚪</span>
          <span className="text-sm font-semibold text-gray-700">Sign Out</span>
        </div>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="px-4 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Exported section ──────────────────────────────────────────────────────────

export default function AccountSection() {
  return (
    <div className="space-y-2 pt-2 border-t border-gray-200">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-0.5">Account</p>
      <ChangePasswordForm />
      <SignOutCard />
    </div>
  )
}
