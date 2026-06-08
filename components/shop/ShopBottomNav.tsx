'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Z } from '@/constants/zIndex'

const GUEST_CART_KEY = 'flexxo_guest_cart'
type GuestCartItem = { productId: string; qty: number }

type Props = {
  isLoggedIn:  boolean
  dbCartCount: number | null   // null = guest
}

export default function ShopBottomNav({ isLoggedIn, dbCartCount }: Props) {
  const pathname = usePathname()

  // Guest cart count hydrated client-side
  const [guestCount, setGuestCount] = useState(0)
  useEffect(() => {
    if (isLoggedIn) return
    function syncCount() {
      try {
        const stored = localStorage.getItem(GUEST_CART_KEY)
        const items  = stored ? (JSON.parse(stored) as GuestCartItem[]) : []
        setGuestCount(items.reduce((s, i) => s + i.qty, 0))
      } catch { setGuestCount(0) }
    }
    syncCount()
    window.addEventListener('storage',          syncCount)
    window.addEventListener('guestCartUpdated', syncCount)
    return () => {
      window.removeEventListener('storage',          syncCount)
      window.removeEventListener('guestCartUpdated', syncCount)
    }
  }, [isLoggedIn])

  const cartCount = isLoggedIn ? (dbCartCount ?? 0) : guestCount
  const cartHref  = isLoggedIn ? '/shop/cart' : '/shop/login?returnUrl=/shop/cart'

  const tabs = [
    {
      href:    '/shop/products',
      label:   'Products',
      active:  pathname.startsWith('/shop/products'),
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'stroke-green-600' : 'stroke-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>
        </svg>
      ),
    },
    {
      href:    isLoggedIn ? '/shop/quotations' : '/shop/login?returnUrl=/shop/quotations',
      label:   'Quotes',
      active:  pathname.startsWith('/shop/quotations'),
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'stroke-green-600' : 'stroke-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"/>
        </svg>
      ),
    },
    {
      href:    isLoggedIn ? '/shop/orders' : '/shop/login?returnUrl=/shop/orders',
      label:   'Orders',
      active:  pathname.startsWith('/shop/orders'),
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'stroke-green-600' : 'stroke-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
        </svg>
      ),
    },
    {
      href:    cartHref,
      label:   'Cart',
      active:  pathname.startsWith('/shop/cart'),
      badge:   cartCount,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'stroke-green-600' : 'stroke-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"/>
        </svg>
      ),
    },
    {
      href:    isLoggedIn ? '#' : '/shop/login',
      label:   isLoggedIn ? 'Account' : 'Sign In',
      active:  pathname.startsWith('/shop/login'),
      isLogout: isLoggedIn,
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'stroke-green-600' : 'stroke-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
        </svg>
      ),
    },
  ]

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200"
      style={{ zIndex: Z.bottomNav, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {tabs.map(tab => {
          const isActive = tab.active

          // Account tab with logout for logged-in users
          if (tab.isLogout) {
            return (
              <form key="account" action="/api/auth/logout" method="POST" className="flex-1">
                <button
                  type="submit"
                  className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                    isActive ? 'text-green-600' : 'text-gray-500'
                  }`}
                >
                  {tab.icon(isActive)}
                  <span>{tab.label}</span>
                </button>
              </form>
            )
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors relative ${
                isActive ? 'text-green-600' : 'text-gray-500'
              }`}
            >
              <span className="relative inline-block">
                {tab.icon(isActive)}
                {/* Cart badge */}
                {(tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1 bg-green-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold leading-none">
                    {(tab.badge ?? 0) > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-green-600 rounded-full" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
