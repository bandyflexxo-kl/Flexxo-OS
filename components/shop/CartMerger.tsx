'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const GUEST_CART_KEY = 'flexxo_guest_cart'

type GuestCartItem = { productId: string; qty: number }

/**
 * Runs once when an authenticated user first enters the (authenticated) layout.
 * Reads the guest localStorage cart, merges items into the DB cart, then clears localStorage.
 * Renders nothing — purely a side-effect component.
 */
export default function CartMerger() {
  const router     = useRouter()
  const hasMerged  = useRef(false)

  useEffect(() => {
    if (hasMerged.current) return
    hasMerged.current = true

    try {
      const stored = localStorage.getItem(GUEST_CART_KEY)
      if (!stored) return

      const items = JSON.parse(stored) as GuestCartItem[]
      if (items.length === 0) return

      // Clear immediately to prevent double-merge on re-render
      localStorage.removeItem(GUEST_CART_KEY)
      window.dispatchEvent(new Event('guestCartUpdated'))

      // Merge all items into the DB cart (fire and forget — failures are silent)
      Promise.all(
        items.map(item =>
          fetch('/api/portal/cart/items', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ productId: item.productId, qty: item.qty }),
          })
        )
      ).then(() => {
        // Refresh to update cart count in ShopNav
        router.refresh()
      }).catch(() => {
        // Non-critical: cart merge failed, items are already cleared from localStorage
      })
    } catch {
      // localStorage not available or JSON parse error — ignore
    }
  }, [router])

  return null
}
