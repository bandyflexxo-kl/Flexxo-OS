'use client'

import { useState } from 'react'
import Image from 'next/image'
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
  availableQty?: number | null   // QNE stock; null/undefined = not yet synced
  isB2B?:       boolean   // optional — card works without it (guest add-to-cart)
  priority?:    boolean   // true for first visible cards — emits <link rel="preload">
}

export default function ProductCard({
  id, name, brand, unit, categoryName, sellingPrice, currency, hasPhoto, availableQty = null, isB2B = false, priority = false,
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
    <div className="group relative bg-white rounded-2xl border border-gray-200 shadow-sm hover:border-green-300 hover:shadow-xl hover:-translate-y-1.5 transition-all duration-200 ease-out overflow-hidden flex flex-col">

      {/* Photo + info — this whole block is the navigation link */}
      <Link href={`/shop/products/${id}`} className="flex flex-col flex-1" tabIndex={0}>

        {/* Photo — Fix 1+5: shop-photo-container (aspect-ratio:1/1, contain:layout)
            ensures browser reserves exact space before image loads, eliminating CLS.
            aspect-square is kept for Tailwind cascade; shop-photo-container reinforces it. */}
        <div className="shop-photo-container aspect-square bg-gray-50">
          {hasPhoto ? (
            <Image
              src={`/api/portal/photo/${id}`}
              alt={name}
              fill
              priority={priority}
              sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
              className="object-contain p-4 group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-14 h-14 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
            </div>
          )}

          {/* StockBadge overlay — top-right corner (Condition 14) */}
          <div className="absolute top-2 right-2">
            <StockBadge status={stockStatus} size="xs" qty={availableQty} />
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
          <p className="text-xs text-green-600 font-medium leading-none flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 inline-block" />
            {categoryName}
          </p>
          <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-green-700 transition-colors duration-200">
            {name}
          </p>
          {brand && <p className="text-xs text-gray-400">{brand}</p>}
          <div className="mt-auto pt-1.5">
            {sellingPrice ? (
              <div className="flex items-baseline gap-1">
                <p className="text-base font-extrabold text-gray-900">{currency} {Number(sellingPrice).toFixed(2)}</p>
                {unit && <span className="text-xs text-gray-400">/ {unit}</span>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Price on request</p>
            )}
            {typeof availableQty === 'number' && availableQty > 0 && availableQty <= 10 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
                Only {availableQty} left
              </span>
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
            className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 active:scale-[0.97] touch-manipulation flex items-center justify-center gap-1.5 ${
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
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
                Added to cart
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
                Add to Cart
              </>
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
