'use client'

/**
 * ReorderButton — adds all items from a past order back to the cart.
 *
 * Condition 24: "Reorder" button on past orders for authenticated users.
 * Calls POST /api/portal/orders/[id]/reorder, then redirects to cart.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import FlexxoSpinner from './FlexxoSpinner'

export default function ReorderButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const router = useRouter()

  async function handleReorder() {
    if (state !== 'idle') return
    setState('loading')

    try {
      const res  = await fetch(`/api/portal/orders/${orderId}/reorder`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setState('error'); setTimeout(() => setState('idle'), 3000); return }
      setState('done')
      router.push('/shop/cart')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  return (
    <button
      onClick={handleReorder}
      disabled={state === 'loading' || state === 'done'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all active:scale-[0.97] ${
        state === 'error'
          ? 'border-red-200 text-red-600 bg-red-50'
          : state === 'done'
          ? 'border-green-200 text-green-700 bg-green-50'
          : 'border-green-200 text-green-700 hover:bg-green-50'
      }`}
    >
      {state === 'loading' ? (
        <><FlexxoSpinner size="xs" color="green" /> Adding…</>
      ) : state === 'done' ? (
        '✓ Added to cart'
      ) : state === 'error' ? (
        '✗ Failed, retry'
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
          </svg>
          Reorder
        </>
      )}
    </button>
  )
}
