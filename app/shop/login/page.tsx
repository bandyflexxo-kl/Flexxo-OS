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
import Image from 'next/image'
import { shopLoginAction, requestAccountAction } from './actions'
import type { LoginState, AccountRequestState } from './actions'

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
      {/* Logo — Fix 1: <Image> with explicit dimensions prevents CLS */}
      <div>
        <Image
          src="/flexxo-logo.png"
          alt="Flexxo"
          width={160}
          height={48}
          priority
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

      {/* Trust stats */}
      <div>
        <div className="grid grid-cols-3 gap-4">
          {TRUST_STATS.map(({ num, label }) => (
            <div key={label} className="bg-white/10 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-white">{num}</p>
              <p className="text-[11px] text-green-200 mt-0.5 font-medium">{label}</p>
            </div>
          ))}
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

      {/* Forgot password */}
      <div className="text-center">
        <ForgotPasswordHint />
      </div>
    </form>
  )
}

// ── Forgot password hint ──────────────────────────────────────────────────────
function ForgotPasswordHint() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Forgot password?
      </button>
      {open && (
        <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-left">
          <p className="text-xs text-blue-700 font-medium mb-1">Need to reset your password?</p>
          <p className="text-xs text-blue-600 leading-relaxed">
            Contact your Flexxo sales representative or email{' '}
            <a href="mailto:admin@flexxo.com.my" className="underline font-medium">
              admin@flexxo.com.my
            </a>{' '}
            and we&apos;ll reset it for you within 1 business day.
          </p>
        </div>
      )}
    </>
  )
}

// ── Request Business Account form — T4-4 ─────────────────────────────────────
type ReqContact = {
  fullName: string; position: string; department: string; email: string
  phone: string; whatsapp: string; influenceLevel: string; isDecisionMaker: boolean
}
const blankContact = (): ReqContact => ({
  fullName: '', position: '', department: '', email: '',
  phone: '', whatsapp: '', influenceLevel: '', isDecisionMaker: false,
})

function RequestAccountSection() {
  const [state, action, pending] = useActionState<AccountRequestState, FormData>(
    requestAccountAction,
    undefined,
  )
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<ReqContact[]>([blankContact()])

  const setContact = (i: number, patch: Partial<ReqContact>) =>
    setContacts(cs => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const addContact    = () => setContacts(cs => cs.length < 3 ? [...cs, blankContact()] : cs)
  const removeContact = (i: number) => setContacts(cs => cs.filter((_, idx) => idx !== i))

  const fieldCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition'

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
            Add up to 3 contacts for your company — we&apos;ll set you up within 1 business day.
          </p>

          {/* Hidden field carries the contacts array to the server action */}
          <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Company Name <span className="text-red-500">*</span>
            </label>
            <input type="text" name="companyName" required autoComplete="organization" className={fieldCls} placeholder="Your Company Sdn Bhd" />
            {state?.errors?.companyName && (
              <p className="text-xs text-red-600 mt-0.5" role="alert">{state.errors.companyName}</p>
            )}
          </div>

          {/* Contact repeater (1–3) */}
          {contacts.map((c, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">
                  {i === 0 ? 'Primary contact (portal login)' : `Contact ${i + 1}`}
                </span>
                {i > 0 && (
                  <button type="button" onClick={() => removeContact(i)} className="text-xs text-red-500 hover:text-red-600">Remove</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={c.fullName} onChange={e => setContact(i, { fullName: e.target.value })} required className={fieldCls} placeholder="Full Name *" />
                <input value={c.position} onChange={e => setContact(i, { position: e.target.value })} className={fieldCls} placeholder="Position" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={c.department} onChange={e => setContact(i, { department: e.target.value })} className={fieldCls} placeholder="Department" />
                <input type="email" value={c.email} onChange={e => setContact(i, { email: e.target.value })} required={i === 0} className={fieldCls} placeholder={i === 0 ? 'Email * (login)' : 'Email'} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={c.phone} onChange={e => setContact(i, { phone: e.target.value })} className={fieldCls} placeholder="Phone" />
                <input value={c.whatsapp} onChange={e => setContact(i, { whatsapp: e.target.value })} className={fieldCls} placeholder="WhatsApp" />
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <select value={c.influenceLevel} onChange={e => setContact(i, { influenceLevel: e.target.value })} className={fieldCls}>
                  <option value="">Influence level…</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={c.isDecisionMaker} onChange={e => setContact(i, { isDecisionMaker: e.target.checked })} className="rounded border-gray-300 text-green-600" />
                  Decision Maker
                </label>
              </div>
            </div>
          ))}

          {contacts.length < 3 && (
            <button type="button" onClick={addContact} className="text-xs font-medium text-green-600 hover:text-green-700">
              + Add another contact ({contacts.length}/3)
            </button>
          )}

          {state?.errors?.contacts && (
            <p className="text-xs text-red-600 mt-0.5" role="alert">{state.errors.contacts}</p>
          )}

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

          {/* Mobile-only logo — Fix 1: <Image> with explicit dims */}
          <div className="lg:hidden text-center mb-8">
            <Image
              src="/flexxo-logo.png"
              alt="Flexxo"
              width={140}
              height={44}
              priority
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
