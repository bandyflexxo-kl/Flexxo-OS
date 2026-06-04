'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const GUEST_CART_KEY = 'flexxo_guest_cart'

type GuestCartItem = { productId: string; qty: number }

export default function ShopNav({
  companyName,
  dbCartCount,
}: {
  companyName:  string | null   // null = guest
  dbCartCount:  number | null   // null = guest (reads from localStorage)
}) {
  const pathname  = usePathname()
  const isLoggedIn = companyName !== null

  // Guest cart count from localStorage (hydrated client-side)
  const [guestCount, setGuestCount] = useState(0)

  useEffect(() => {
    if (isLoggedIn) return  // B2B uses dbCartCount
    function syncCount() {
      try {
        const stored = localStorage.getItem(GUEST_CART_KEY)
        if (stored) {
          const items = JSON.parse(stored) as GuestCartItem[]
          setGuestCount(items.reduce((s, i) => s + i.qty, 0))
        } else {
          setGuestCount(0)
        }
      } catch { setGuestCount(0) }
    }
    syncCount()
    // Update when other tabs/components change localStorage
    window.addEventListener('storage', syncCount)
    window.addEventListener('guestCartUpdated', syncCount)
    return () => {
      window.removeEventListener('storage', syncCount)
      window.removeEventListener('guestCartUpdated', syncCount)
    }
  }, [isLoggedIn])

  const cartCount = isLoggedIn ? (dbCartCount ?? 0) : guestCount
  const cartHref  = isLoggedIn ? '/shop/cart' : '/shop/login?returnUrl=/shop/cart'

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">

        {/* Brand */}
        <Link href="/shop/products" className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center">F</div>
          <span className="font-bold text-gray-900 text-sm">Flexxo Shop</span>
        </Link>

        {/* Nav */}
        <nav className="hidden sm:flex items-center gap-1 flex-1 justify-center">
          <Link
            href="/shop/products"
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              pathname.startsWith('/shop/products') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Products
          </Link>
          {isLoggedIn && (
            <Link
              href="/shop/quotations"
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/shop/quotations') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Quotations
            </Link>
          )}
          {isLoggedIn && (
            <Link
              href="/shop/orders"
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/shop/orders') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Orders
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Company name badge */}
          {isLoggedIn && (
            <span className="hidden sm:block text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg truncate max-w-[140px]" title={companyName ?? ''}>
              {companyName}
            </span>
          )}

          {/* Cart */}
          <Link
            href={cartHref}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span className="hidden sm:inline text-sm">Cart</span>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-semibold leading-none">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Link>

          {/* Auth button */}
          {isLoggedIn ? (
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="text-sm text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href={`/shop/login?returnUrl=${encodeURIComponent(pathname)}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
