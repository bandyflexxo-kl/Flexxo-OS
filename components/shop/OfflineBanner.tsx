'use client'

/**
 * OfflineBanner — T6-6
 * Detects browser online/offline events and shows an amber warning banner.
 * Explicit bg-amber-400 background — never transparent — so it's visible on
 * any OS theme (G-3). High-contrast: dark text on amber.
 */

import { useEffect, useState } from 'react'
import { Z } from '@/constants/zIndex'

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    // Initialise from navigator.onLine
    setIsOffline(!navigator.onLine)

    function handleOffline() { setIsOffline(true) }
    function handleOnline()  { setIsOffline(false) }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online',  handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online',  handleOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full bg-amber-400 text-amber-900 text-sm font-medium text-center px-4 py-2 flex items-center justify-center gap-2"
      style={{ zIndex: Z.offlineBanner, position: 'relative' }}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      You&apos;re offline — please check your internet connection to browse products or place orders.
    </div>
  )
}
