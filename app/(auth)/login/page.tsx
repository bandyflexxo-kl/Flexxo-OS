'use client'

import { useActionState } from 'react'
import { loginAction } from './actions'

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Flexxo Sales OS</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>
        <form action={action} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
              placeholder="admin@flexxo.com.my"
            />
            {state?.errors?.email && <p className="text-xs text-red-500">{state.errors.email}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-gray-700">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
            {state?.errors?.password && <p className="text-xs text-red-500">{state.errors.password}</p>}
          </div>
          {state?.message && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.message}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors flex items-center justify-center gap-2"
          >
            {pending && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
