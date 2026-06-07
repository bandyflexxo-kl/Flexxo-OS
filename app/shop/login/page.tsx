'use client'

import { useActionState } from 'react'
import { shopLoginAction } from './actions'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const returnUrl    = searchParams.get('returnUrl') ?? ''
  const [state, action, pending] = useActionState(shopLoginAction, undefined)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-sm p-8 space-y-6">
        {/* Brand */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-green-600 to-green-700 text-white text-xl font-bold mb-2 shadow-sm">F</div>
          <h1 className="text-xl font-bold text-gray-900">Flexxo Shop</h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>

        <form action={action} className="space-y-4">
          {/* Hidden returnUrl */}
          {returnUrl && <input type="hidden" name="returnUrl" value={returnUrl} />}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
              placeholder="your@company.com"
            />
            {state?.errors?.email && <p className="text-xs text-red-600 mt-1">{state.errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition"
            />
            {state?.errors?.password && <p className="text-xs text-red-600 mt-1">{state.errors.password}</p>}
          </div>

          {state?.message && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {state.message}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors active:scale-[0.98]"
          >
            {pending ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-400">
          Need a business account?{' '}
          <span className="text-gray-600 font-medium">Contact your Flexxo representative.</span>
        </p>
      </div>
    </div>
  )
}

export default function ShopLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
