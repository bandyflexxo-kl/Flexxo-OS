'use client'

/**
 * /shop/account — B2B client account & profile page.
 *
 * Shows: company name, user name, email, mobile.
 * Actions: change password.
 *
 * Wrapped by /shop/(authenticated)/layout.tsx — already requires B2B Client login.
 */

import { useEffect, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type AccountProfile = {
  id:          string
  name:        string
  email:       string
  mobileNo:    string | null
  companyName: string | null
  companyId:   string | null
  lastLoginAt: string | null
}

// ── Account info card ────────────────────────────────────────────────────────

function ProfileCard({ profile }: { profile: AccountProfile }) {
  const initials = profile.name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 font-bold text-xl flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900">{profile.name}</p>
          <p className="text-sm text-gray-500 mt-0.5">{profile.email}</p>
          {profile.companyName && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-md px-2 py-0.5 mt-1.5 inline-block font-medium">
              {profile.companyName}
            </p>
          )}
        </div>
      </div>

      {/* Details row */}
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Email</p>
          <p className="text-gray-700 truncate">{profile.email}</p>
        </div>
        {profile.mobileNo && (
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Mobile</p>
            <p className="text-gray-700">{profile.mobileNo}</p>
          </div>
        )}
        {profile.lastLoginAt && (
          <div className="col-span-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Last login</p>
            <p className="text-gray-500 text-xs">
              {new Date(profile.lastLoginAt).toLocaleString('en-MY', {
                dateStyle: 'medium', timeStyle: 'short',
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Change password form ──────────────────────────────────────────────────────

function ChangePasswordForm() {
  const [currentPw, setCurrentPw]   = useState('')
  const [newPw,     setNewPw]       = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [error,     setError]       = useState<string | null>(null)
  const [success,   setSuccess]     = useState(false)
  const [pending,   setPending]     = useState(false)
  const [showPw,    setShowPw]      = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPw.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPw !== confirmPw) {
      setError('New password and confirmation do not match.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/portal/account', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Password change failed.')
        return
      }
      setSuccess(true)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition pr-10'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Change Password</h3>

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-green-600">✓</span>
          <p className="text-sm text-green-700 font-medium">Password changed successfully.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Current password */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Current Password
          </label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              autoComplete="current-password"
              className={inputCls}
              placeholder="Enter current password"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={showPw ? 'Hide password' : 'Show password'}
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
        </div>

        {/* New password */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            New Password
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            required
            autoComplete="new-password"
            className={inputCls}
            placeholder="At least 8 characters"
          />
        </div>

        {/* Confirm password */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Confirm New Password
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            required
            autoComplete="new-password"
            className={inputCls}
            placeholder="Repeat new password"
          />
        </div>

        {error && (
          <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          {pending ? 'Saving…' : 'Update Password'}
        </button>
      </form>
    </div>
  )
}

// ── Spending history chart ────────────────────────────────────────────────────

type SpendingMonth = { month: string; amount: number }

function SpendingHistoryCard() {
  const [data,    setData]    = useState<SpendingMonth[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal/account/spending')
      .then(r => r.json())
      .then((d: { months: SpendingMonth[] }) => { setData(d.months); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="h-3 w-36 bg-gray-100 rounded animate-pulse mb-4" />
        <div className="h-16 bg-gray-50 rounded animate-pulse" />
      </div>
    )
  }

  const hasData = data && data.some(m => m.amount > 0)
  const max     = Math.max(...(data ?? []).map(m => m.amount), 1)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span>📈</span> Spending History
        <span className="ml-auto text-[10px] font-normal text-gray-400">last 6 months</span>
      </h3>

      {hasData ? (
        <>
          {/* Bar chart */}
          <div className="flex items-end gap-2 h-20 mb-2">
            {data!.map(m => {
              const heightPct = m.amount > 0 ? Math.max((m.amount / max) * 100, 8) : 2
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5">
                  {m.amount > 0 && (
                    <p className="text-[9px] text-gray-500 font-medium leading-none mb-0.5">
                      {m.amount >= 1000
                        ? `${(m.amount / 1000).toFixed(1)}k`
                        : Math.round(m.amount).toString()}
                    </p>
                  )}
                  <div
                    className="w-full rounded-t bg-green-500"
                    style={{ height: `${heightPct}%`, opacity: m.amount > 0 ? 1 : 0.15, minHeight: '2px' }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            {data!.map(m => (
              <p key={m.month} className="flex-1 text-center text-[9px] text-gray-400 truncate">{m.month}</p>
            ))}
          </div>
        </>
      ) : (
        <div className="py-4 text-center space-y-1">
          <p className="text-xs text-gray-400">No orders yet — your spending history will appear here.</p>
          <a href="/shop/products" className="text-xs font-semibold text-green-600 hover:text-green-700 transition-colors">
            Browse Products →
          </a>
        </div>
      )}
    </div>
  )
}

// ── Sign out ──────────────────────────────────────────────────────────────────

function SignOutCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Sign Out</h3>
      <p className="text-xs text-gray-500 mb-4">
        You&apos;ll need to sign in again to access your account and prices.
      </p>
      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="w-full py-2.5 border border-red-200 text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors"
        >
          Sign Out
        </button>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal/account')
      .then(r => r.json())
      .then((data: AccountProfile) => { setProfile(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
      <div className="mb-2">
        <h2 className="text-lg font-bold text-gray-900">My Account</h2>
        <p className="text-sm text-gray-500 mt-0.5">View your profile and manage your password.</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          </div>
        </div>
      ) : profile ? (
        <ProfileCard profile={profile} />
      ) : (
        <p className="text-sm text-gray-500 text-center py-8">Could not load profile.</p>
      )}

      <SpendingHistoryCard />
      <ChangePasswordForm />
      <SignOutCard />
    </div>
  )
}
