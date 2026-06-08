'use client'

/**
 * T6-1: Root-level error boundary.
 * Catches unhandled errors in any app route that doesn't have its own error.tsx.
 * G-3: explicit bg-white — never transparent.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // In production, send to error reporting (Sentry etc — T6-8)
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
        style={{ backgroundColor: '#fef2f2' }}
      >
        <span className="text-3xl">⚠️</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-500 max-w-sm mb-6">
        An unexpected error occurred. This has been logged. Please try again, or contact Flexxo if the problem persists.
      </p>
      <button
        onClick={reset}
        className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
