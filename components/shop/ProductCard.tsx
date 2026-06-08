'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FlexxoSpinner from './FlexxoSpinner'
import StockBadge from './StockBadge'
import type { StockStatus } from './StockBadge'

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

  const stockStatus: StockStatus = sellingPrice ? 'in-stock' : 'available'

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
    <div className="group relative bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">

      {/* Photo + info — this whole block is the navigation link */}
      <Link href={`/shop/products/${id}`} className="flex flex-col flex-1" tabIndex={0}>

        {/* Photo — aspect-square for consistent grid */}
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

          {/* StockBadge overlay — top-right corner (Condition 14) */}
          <div className="absolute top-2 right-2">
            <StockBadge status={stockStatus} size="xs" />
          </div>

          {/* "Added ✓" flash overlay (Add-to-Cart state 3 — success) */}
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
          <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-green-700 transition-colors duration-200">
            {name}
          </p>
          {brand && <p className="text-xs text-gray-400">{brand}</p>}
          <div className="mt-auto pt-1.5">
            {/* T4-2: Hide B2B prices from guests — protect pricing confidentiality */}
            {!isB2B ? (
              <p className="text-xs text-green-600 font-medium">Sign in for pricing →</p>
            ) : sellingPrice ? (
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

      {/* Add to Cart / Sign In — guests see sign-in prompt, B2B see 3-state button */}
      <div className="px-3 pb-3">
        {isB2B ? (
          <button
            onClick={handleAddToCart}
            disabled={cartState === 'loading'}
            aria-label={cartState === 'added' ? 'Added to cart' : `Add ${name} to cart`}
            className={`w-full py-2 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-[0.97] touch-manipulation flex items-center justify-center gap-1.5 ${
              cartState === 'added'
                ? 'bg-green-500 text-white'
                : cartState === 'loading'
                ? 'bg-green-400 text-white cursor-wait'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {cartState === 'loading' ? (
              <><FlexxoSpinner size="xs" color="white" /> Adding…</>
            ) : cartState === 'added' ? (
              '✓ Added to cart'
            ) : (
              '🛒 Add to Cart'
            )}
          </button>
        ) : (
          <a
            href={`/shop/login?returnUrl=${encodeURIComponent(`/shop/products/${id}`)}`}
            className="w-full py-2 rounded-lg text-xs font-semibold text-center block transition-colors text-green-700 border border-green-200 hover:bg-green-50"
          >
            Sign In to Order
          </a>
        )}
      </div>

    </div>
  )
}
