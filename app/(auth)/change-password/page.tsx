'use client'

import { useActionState } from 'react'
import { changePasswordAction } from './actions'

export default function ChangePasswordPage() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-sm p-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Set your password</h1>
          <p className="text-sm text-gray-500 mt-1">
            You must set a new password before continuing.
          </p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="Minimum 8 characters"
            />
            {state?.errors?.password && (
              <p className="text-xs text-red-600 mt-1">{state.errors.password}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password
            </label>
            <input
              type="password"
              name="confirmPassword"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              placeholder="Repeat your new password"
            />
            {state?.errors?.confirmPassword && (
              <p className="text-xs text-red-600 mt-1">{state.errors.confirmPassword}</p>
            )}
          </div>

          {state?.message && (
            <p className="text-xs text-red-600">{state.message}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
