'use client'

/**
 * NavigationProgress — thin green top-bar that appears during route transitions.
 *
 * Uses a custom DOM event ("nav:start") dispatched by any component that
 * triggers navigation (ShopBottomNav, ShopNav links).
 * Disappears automatically when `usePathname` changes (navigation complete).
 *
 * z-index: above everything (hardcoded 9999 — not a reusable UI layer,
 * this is a browser-chrome-level indicator).
 */

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, Suspense } from 'react'

function ProgressBar() {
  const pathname      = usePathname()
  const searchParams  = useSearchParams()
  const [active, setActive]   = useState(false)
  const [pct,    setPct]      = useState(0)
  const prevKey   = useRef(pathname + searchParams.toString())
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animRef   = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)

  // Animate bar from 0 → 80% quickly, then slow-creep to 92%
  function startProgress() {
    setActive(true)
    setPct(0)
    // rAF trick: set to 0 first, then trigger transition on next frame
    animRef.current = requestAnimationFrame(() => {
      animRef.current = requestAnimationFrame(() => setPct(80))
    })
    // Slowly creep toward 92 so it feels alive
    timerRef.current = setTimeout(() => setPct(92), 800)
  }

  // Complete and fade out
  function finishProgress() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPct(100)
    timerRef.current = setTimeout(() => {
      setActive(false)
      setPct(0)
    }, 350)
  }

  // Listen for custom event from nav components
  useEffect(() => {
    function onNavStart() { startProgress() }
    window.addEventListener('nav:start', onNavStart)
    return () => window.removeEventListener('nav:start', onNavStart)
  }, [])

  // Complete when pathname/searchParams change (navigation finished)
  useEffect(() => {
    const key = pathname + searchParams.toString()
    if (key !== prevKey.current) {
      prevKey.current = key
      finishProgress()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current)  clearTimeout(timerRef.current)
      if (animRef.current)   cancelAnimationFrame(animRef.current)
    }
  }, [])

  if (!active && pct === 0) return null

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[3px] pointer-events-none"
      style={{ zIndex: 9999 }}
    >
      <div
        className="h-full bg-green-500 transition-all ease-out"
        style={{
          width:              `${pct}%`,
          transitionDuration: pct === 100 ? '200ms' : pct === 0 ? '0ms' : '600ms',
          opacity:            active ? 1 : 0,
          transitionProperty: 'width, opacity',
        }}
      />
    </div>
  )
}

// Suspense boundary required because useSearchParams is inside
export default function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  )
}
