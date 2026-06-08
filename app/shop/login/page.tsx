'use client'

/**
 * ShopLoginPage — T4-3: Split-layout login page.
 *
 * LEFT PANEL  — Flexxo brand panel (bg-green-800, never transparent — G-3).
 *               Brand story, 3 key trust stats, client logos strip, T4-8.
 * RIGHT PANEL — Login form + T4-4 Request Business Account form.
 *
 * Both panels have explicit background-color to prevent OS dark mode
 * bleed-through (G-3).
 */

import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { shopLoginAction, requestAccountAction } from './actions'
import type { LoginState, AccountRequestState } from './actions'

// ── Client logos (text-based — no external img dependencies) ────────────────
const CLIENT_LOGOS = [
  ['CIMB', 'Public Bank', 'Maybank'],
  ['Samsung', 'Nestle', 'Gamuda'],
  ['St Regis', 'Schlumberger', 'Axiata'],
]

const TRUST_STATS = [
  { num: '15+',    label: 'Years in business' },
  { num: '3,700+', label: 'Products available' },
  { num: '500+',   label: 'Corporate clients' },
]

// ── Left brand panel ─────────────────────────────────────────────────────────
function BrandPanel() {
  return (
    <div
      className="hidden lg:flex flex-col justify-between p-10 xl:p-12"
      style={{ backgroundColor: '#15803d' }} /* green-700 — explicit, never inherited (G-3) */
    >
      {/* Logo */}
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/flexxo-logo.png"
          alt="Flexxo"
          width={160}
          height={48}
          className="h-12 w-auto object-contain brightness-0 invert mb-8"
        />
        <h1 className="text-2xl xl:text-3xl font-extrabold text-white leading-snug mb-3">
          Your 1-Stop Office Partner<br />
          <span className="text-green-200">for Malaysian Businesses</span>
        </h1>
        <p className="text-green-100 text-sm leading-relaxed max-w-sm">
          Trusted by banks, MNCs and SMEs across Malaysia for stationery,
          pantry supplies, hygiene, furniture and more — with B2B pricing
          and dedicated sales support.
        </p>
      </div>

      {/* Trust stats — T4-8 */}
      <div className="space-y-8">
        <div className="grid grid-cols-3 gap-4">
          {TRUST_STATS.map(({ num, label }) => (
            <div key={label} className="bg-white/10 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-white">{num}</p>
              <p className="text-[11px] text-green-200 mt-0.5 font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* Client logos — T4-8 */}
        <div>
          <p className="text-xs text-green-300 font-semibold uppercase tracking-widest mb-3">
            Trusted by Malaysia&apos;s leading organisations
          </p>
          <div className="space-y-2">
            {CLIENT_LOGOS.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map(name => (
                  <span
                    key={name}
                    className="flex-1 text-center text-xs font-semibold text-white/80 bg-white/10 border border-white/20 rounded-lg py-1.5 px-2 truncate"
                  >
                    {name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Login form ────────────────────────────────────────────────────────────────
function LoginFormSection({ returnUrl }: { returnUrl: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(shopLoginAction, undefined)

  return (
    <form action={action} className="space-y-4">
      {returnUrl && <input type="hidden" name="returnUrl" value={returnUrl} />}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Work Email
        </label>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
          placeholder="you@company.com"
        />
        {state?.errors?.email && (
          <p className="text-xs text-red-600 mt-1" role="alert">{state.errors.email}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
        />
        {state?.errors?.password && (
          <p className="text-xs text-red-600 mt-1" role="alert">{state.errors.password}</p>
        )}
      </div>

      {state?.message && (
        <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
      >
        {pending ? 'Signing in…' : 'Sign In →'}
      </button>
    </form>
  )
}

// ── Request Business Account form — T4-4 ─────────────────────────────────────
function RequestAccountSection() {
  const [state, action, pending] = useActionState<AccountRequestState, FormData>(
    requestAccountAction,
    undefined,
  )
  const [open, setOpen] = useState(false)

  if (state?.success) {
    return (
      <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-green-600 text-lg leading-none mt-0.5">✓</span>
          <div>
            <p className="text-sm font-semibold text-green-800">Request received!</p>
            <p className="text-xs text-green-600 mt-0.5">
              We&apos;ll be in touch within 1 business day to set up your B2B account.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-gray-800 transition-colors"
        aria-expanded={open}
      >
        <span>
          Don&apos;t have an account?{' '}
          <span className="text-green-600 font-medium">Request one →</span>
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {open && (
        <form action={action} className="mt-4 space-y-3">
          <p className="text-xs text-gray-500 pb-1">
            Fill in your details and we&apos;ll get you set up within 1 business day.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                required
                autoComplete="name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
                placeholder="Ahmad Bin Ali"
              />
              {state?.errors?.fullName && (
                <p className="text-xs text-red-600 mt-0.5" role="alert">{state.errors.fullName}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
                placeholder="012-345 6789"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Company Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="companyName"
              required
              autoComplete="organization"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
              placeholder="Your Company Sdn Bhd"
            />
            {state?.errors?.companyName && (
              <p className="text-xs text-red-600 mt-0.5" role="alert">{state.errors.companyName}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Work Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
              placeholder="you@company.com"
            />
            {state?.errors?.email && (
              <p className="text-xs text-red-600 mt-0.5" role="alert">{state.errors.email}</p>
            )}
          </div>

          {state?.message && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            {pending ? 'Sending…' : 'Request Account'}
          </button>
        </form>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
function LoginPage() {
  const searchParams = useSearchParams()
  const returnUrl    = searchParams.get('returnUrl') ?? ''

  return (
    /* G-3: min-h-screen bg-white — explicit, never inherited */
    <div className="min-h-screen bg-white flex">

      {/* Left — brand panel (desktop only) */}
      <div className="lg:w-[480px] xl:w-[520px] shrink-0">
        <BrandPanel />
      </div>

      {/* Right — login / request form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">

          {/* Mobile-only logo */}
          <div className="lg:hidden text-center mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/flexxo-logo.png"
              alt="Flexxo"
              width={140}
              height={44}
              className="h-11 w-auto mx-auto object-contain"
            />
          </div>

          {/* Title */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in to your Flexxo business account</p>
          </div>

          {/* Login form — T5-2: inline validation */}
          <LoginFormSection returnUrl={returnUrl} />

          {/* Request account — T4-4 */}
          <RequestAccountSection />
        </div>
      </div>
    </div>
  )
}

export default function ShopLoginPage() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  )
}
