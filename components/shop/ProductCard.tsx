'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const GUEST_CART_KEY = 'flexxo_guest_cart'

type Props = {
  id:           string
  name:         string
  brand:        string | null
  unit:         string | null
  categoryName: string
  sellingPrice: string | null
  currency:     string
  hasPhoto:     boolean
  isB2B?:       boolean   // optional — card works without it (guest add-to-cart)
}

export default function ProductCard({
  id, name, brand, unit, categoryName, sellingPrice, currency, hasPhoto, isB2B = false,
}: Props) {
  const router = useRouter()
  const [cartState, setCartState] = useState<'idle' | 'loading' | 'added'>('idle')

  async function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (cartState !== 'idle') return

    setCartState('loading')

    try {
      if (isB2B) {
        // B2B: call the API
        const res = await fetch('/api/portal/cart/items', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ productId: id, qty: 1 }),
        })
        if (!res.ok) { setCartState('idle'); return }
        router.refresh() // update nav cart count
      } else {
        // Guest: localStorage
        const stored = localStorage.getItem(GUEST_CART_KEY)
        const items: { productId: string; qty: number }[] = stored ? JSON.parse(stored) as { productId: string; qty: number }[] : []
        const existing = items.find(i => i.productId === id)
        if (existing) { existing.qty += 1 } else { items.push({ productId: id, qty: 1 }) }
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items))
        window.dispatchEvent(new Event('guestCartUpdated'))
      }

      setCartState('added')
      setTimeout(() => setCartState('idle'), 1800)
    } catch {
      setCartState('idle')
    }
  }

  return (
    <div className="group relative bg-white rounded-xl border border-gray-200 hover:border-green-200 hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col">

      {/* Photo + info — this whole block is the navigation link */}
      <Link href={`/shop/products/${id}`} className="flex flex-col flex-1" tabIndex={0}>

        {/* Photo */}
        <div className="aspect-square bg-gray-50 relative overflow-hidden">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/portal/photo/${id}`}
              alt={name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl text-gray-200">
              📦
            </div>
          )}

          {/* "Added ✓" flash overlay */}
          {cartState === 'added' && (
            <div className="absolute inset-0 flex items-center justify-center bg-green-500/90 transition-opacity">
              <div className="text-white text-center">
                <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                </svg>
                <p className="text-xs font-bold mt-1">Added!</p>
              </div>
            </div>
          )}
        </div>

        {/* Text info */}
        <div className="p-3 flex flex-col gap-1 flex-1">
          <p className="text-xs text-green-600 font-medium leading-none">{categoryName}</p>
          <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-green-700 transition-colors">
            {name}
          </p>
          {brand && <p className="text-xs text-gray-400">{brand}</p>}
          <div className="mt-auto pt-1.5">
            {sellingPrice ? (
              <div className="flex items-baseline gap-1">
                <p className="text-sm font-bold text-gray-900">{currency} {Number(sellingPrice).toFixed(2)}</p>
                {unit && <span className="text-xs text-gray-400">/ {unit}</span>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Price on request</p>
            )}
          </div>
        </div>
      </Link>

      {/* Add to Cart button — always visible (touch-friendly, no hover required) */}
      <div className="px-3 pb-3">
        <button
          onClick={handleAddToCart}
          disabled={cartState === 'loading'}
          className={`w-full py-2 rounded-lg text-xs font-semibold transition-all active:scale-[0.97] touch-manipulation ${
            cartState === 'added'
              ? 'bg-green-500 text-white'
              : cartState === 'loading'
              ? 'bg-green-400 text-white cursor-wait'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {cartState === 'added'   ? '✓ Added to cart' :
           cartState === 'loading' ? '…'               :
           '🛒 Add to Cart'}
        </button>
      </div>

    </div>
  )
}
