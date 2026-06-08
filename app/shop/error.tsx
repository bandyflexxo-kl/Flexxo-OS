'use client'

/**
 * T6-1: Shop route error boundary.
 * Catches unhandled errors in all /shop/* routes.
 * Shows on-brand recovery UI with links to products and support.
 * G-3: explicit bg-white — never transparent.
 */

import { useEffect } from 'react'
import Link from 'next/link'

export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ShopError]', error)
  }, [error])

  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-16 text-center"
      style={{ backgroundColor: '#ffffff' }} /* G-3 explicit */
    >
      <div
        className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
        style={{ backgroundColor: '#f0fdf4' }}
      >
        <span className="text-3xl">🔄</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-500 max-w-xs mb-6 leading-relaxed">
        We couldn&apos;t load this page. Please try again or browse other products.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/shop/products"
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
        >
          Browse Products
        </Link>
      </div>
    </div>
  )
}
