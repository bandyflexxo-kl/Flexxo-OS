'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Z } from '@/constants/zIndex'

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
    <header className="bg-white border-b border-gray-200 sticky top-0" style={{ zIndex: Z.stickyNav }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">

        {/* Brand — always visible */}
        <Link href="/shop/products" className="flex items-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/flexxo-logo.png"
            alt="Flexxo — Your 1stop Office Partner"
            className="h-9 sm:h-10 w-auto object-contain"
          />
        </Link>

        {/* Desktop nav — hidden on mobile (bottom nav handles mobile) */}
        {/* Event delegation: any link click in the nav fires nav:start for the progress bar */}
        <nav
          className="hidden sm:flex items-center gap-1 flex-1 justify-center"
          onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a')
            if (anchor) {
              const href = anchor.getAttribute('href')
              if (href && !pathname.startsWith(href.split('?')[0]) && href.startsWith('/shop/')) {
                window.dispatchEvent(new Event('nav:start'))
              }
            }
          }}
        >
          <Link
            href="/shop/products"
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              pathname.startsWith('/shop/products') ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Products
          </Link>
          {isLoggedIn && (
            <Link
              href="/shop/quotations"
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/shop/quotations') ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Quotations
            </Link>
          )}
          {isLoggedIn && (
            <Link
              href="/shop/orders"
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/shop/orders') ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              My Orders
            </Link>
          )}
          {isLoggedIn && (
            <Link
              href="/shop/account"
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/shop/account') ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Account
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Company name badge — desktop only */}
          {isLoggedIn && (
            <span className="hidden sm:block text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg truncate max-w-[140px]" title={companyName ?? ''}>
              {companyName}
            </span>
          )}

          {/* Cart icon — always visible on mobile, also on desktop */}
          <Link
            href={cartHref}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label={`Cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
              />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-green-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold leading-none">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Link>

          {/* Desktop cart label */}
          <span className="hidden sm:inline text-sm text-gray-600">Cart</span>

          {/* Auth button — desktop only (mobile uses bottom nav) */}
          {isLoggedIn ? (
            <form action="/api/auth/logout" method="POST" className="hidden sm:block">
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
              className="hidden sm:inline-flex text-sm font-medium text-green-600 hover:text-green-700 px-3 py-1.5 rounded-lg border border-green-200 hover:bg-green-50 transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
