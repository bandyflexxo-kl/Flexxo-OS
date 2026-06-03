'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const GUEST_CART_KEY = 'flexxo_guest_cart'

type GuestCartItem = { productId: string; qty: number }

export default function CartButton({
  productId,
  minOrderQty = 1,
  isLoggedIn,
  loginUrl,
}: {
  productId:   string
  minOrderQty?: number
  isLoggedIn:  boolean
  loginUrl:    string
}) {
  const [qty,     setQty]     = useState(minOrderQty)
  const [loading, setLoading] = useState(false)
  const [added,   setAdded]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const router = useRouter()

  function addToGuestCart() {
    try {
      const stored = localStorage.getItem(GUEST_CART_KEY)
      const items: GuestCartItem[] = stored ? JSON.parse(stored) as GuestCartItem[] : []
      const existing = items.find(i => i.productId === productId)
      if (existing) {
        existing.qty += qty
      } else {
        items.push({ productId, qty })
      }
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items))
      // Notify ShopNav to update badge
      window.dispatchEvent(new Event('guestCartUpdated'))
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } catch {
      setError('Could not add to cart. Please try again.')
    }
  }

  async function addToB2BCart() {
    if (qty < 1) return
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/portal/cart/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId, qty }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to add to cart'); return }
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  function handleClick() {
    if (!isLoggedIn) {
      // Guest: add to localStorage and show feedback
      addToGuestCart()
      return
    }
    void addToB2BCart()
  }

  return (
    <div className="space-y-3">
      {/* Qty selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Qty:</label>
        <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden">
          <button
            onClick={() => setQty(q => Math.max(minOrderQty, q - 1))}
            className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors text-lg"
          >
            −
          </button>
          <input
            type="number"
            value={qty}
            min={minOrderQty}
            onChange={e => setQty(Math.max(minOrderQty, parseInt(e.target.value, 10) || minOrderQty))}
            className="w-14 text-center text-sm border-0 outline-none"
          />
          <button
            onClick={() => setQty(q => q + 1)}
            className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors text-lg"
          >
            +
          </button>
        </div>
      </div>

      {/* Add to cart / Sign in prompt */}
      {isLoggedIn ? (
        <button
          onClick={handleClick}
          disabled={loading || added}
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
            added
              ? 'bg-green-600 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          {loading ? 'Adding…' : added ? '✓ Added to cart!' : '🛒 Add to Cart'}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            onClick={handleClick}
            disabled={added}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
              added ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {added ? '✓ Added to cart!' : '🛒 Add to Cart'}
          </button>
          <a
            href={loginUrl}
            className="block w-full py-2.5 rounded-xl text-sm font-medium text-center border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Sign in for B2B pricing &amp; checkout
          </a>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
