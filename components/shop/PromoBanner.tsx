'use client'

/**
 * PromoBanner — dismissible promotional banner shown above main content.
 *
 * Condition 23: dismissible using sessionStorage, renders above/below navbar.
 * Hidden after user clicks ✕; returns on new session/tab.
 */

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'flexxo_promo_banner_dismissed'

export default function PromoBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show if not dismissed this session
    try {
      const dismissed = sessionStorage.getItem(STORAGE_KEY)
      if (!dismissed) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try { sessionStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  }

  if (!visible) return null

  return (
    <div className="bg-green-700 text-white text-xs sm:text-sm" role="banner">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Megaphone icon */}
          <svg className="w-4 h-4 shrink-0 text-green-200" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2v-4.011l10 2A1 1 0 0019 13V4a1 1 0 00-1-1z"/>
          </svg>
          <p className="truncate">
            <span className="font-semibold">🎉 B2B Exclusive:</span>
            {' '}Free delivery on orders above MYR 500 · Monthly promo deals for registered businesses
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss promotion"
          className="shrink-0 text-green-200 hover:text-white transition-colors ml-2 p-0.5 rounded"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
