'use client'

/**
 * StickyCartBar — always-visible add-to-cart bar at bottom of product detail on mobile.
 *
 * Condition 15: qty +/- stepper (also in CartButton for desktop)
 * Condition 20: sticky Add-to-Cart bar at bottom on mobile product detail page.
 *
 * Hidden on sm+ (desktop uses the in-page CartButton instead).
 * Cart logic mirrors CartButton but is standalone for mobile UX.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import FlexxoSpinner from './FlexxoSpinner'
import { Z } from '@/constants/zIndex'

const GUEST_CART_KEY = 'flexxo_guest_cart'

export default function StickyCartBar({
  productId,
  productName,
  price,
  currency,
  unit,
  minOrderQty = 1,
  isLoggedIn,
  loginUrl,
}: {
  productId:    string
  productName:  string
  price:        string | null
  currency:     string
  unit:         string | null
  minOrderQty?: number
  isLoggedIn:   boolean
  loginUrl:     string
}) {
  const [qty,     setQty]     = useState(minOrderQty)
  const [state,   setState]   = useState<'idle' | 'loading' | 'added'>('idle')
  const router = useRouter()

  async function handleAdd() {
    if (state !== 'idle') return
    setState('loading')

    try {
      if (isLoggedIn) {
        const res = await fetch('/api/portal/cart/items', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ productId, qty }),
        })
        if (!res.ok) { setState('idle'); return }
        router.refresh()
      } else {
        const stored = localStorage.getItem(GUEST_CART_KEY)
        const items: { productId: string; qty: number }[] = stored
          ? JSON.parse(stored) as { productId: string; qty: number }[]
          : []
        const existing = items.find(i => i.productId === productId)
        if (existing) { existing.qty += qty } else { items.push({ productId, qty }) }
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items))
        window.dispatchEvent(new Event('guestCartUpdated'))
      }

      setState('added')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }

  return (
    /* sm:hidden — desktop uses in-page CartButton.
       bottom-14 (56px) positions this above ShopBottomNav (fixed bottom-0 z-40 ~56px tall)
       so the bottom nav remains visible on mobile product detail pages. */
    <div
      className="sm:hidden fixed bottom-14 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3 shadow-lg"
      style={{ zIndex: Z.stickyCart }}
    >
      {/* Product info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-900 truncate">{productName}</p>
        {price ? (
          <p className="text-sm font-bold text-green-700 mt-0.5">
            {currency} {Number(price).toFixed(2)}
            {unit && <span className="text-xs font-normal text-gray-400"> / {unit}</span>}
          </p>
        ) : (
          <p className="text-xs text-gray-400 italic mt-0.5">Price on request</p>
        )}
      </div>

      {/* Qty stepper */}
      <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden shrink-0">
        <button
          onClick={() => setQty(q => Math.max(minOrderQty, q - 1))}
          disabled={qty <= minOrderQty}
          className="w-8 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors text-base touch-manipulation"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
        <button
          onClick={() => setQty(q => q + 1)}
          className="w-8 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors text-base touch-manipulation"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      {/* Add to cart button */}
      {isLoggedIn ? (
        <button
          onClick={handleAdd}
          disabled={state === 'loading'}
          className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] touch-manipulation ${
            state === 'added'
              ? 'bg-green-500 text-white'
              : state === 'loading'
              ? 'bg-green-400 text-white cursor-wait'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {state === 'loading' ? (
            <FlexxoSpinner size="sm" color="white" />
          ) : state === 'added' ? (
            '✓ Added!'
          ) : (
            '🛒 Add'
          )}
        </button>
      ) : (
        <a
          href={loginUrl}
          className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          Sign In
        </a>
      )}
    </div>
  )
}
