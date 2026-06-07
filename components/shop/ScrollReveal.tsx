'use client'

/**
 * ScrollReveal — IntersectionObserver-based scroll-triggered animation.
 *
 * Condition 19: ≥3 sections with scroll-triggered animations.
 * Uses CSS transitions (no Framer Motion) to fade+slide up when entering viewport.
 * Disconnects observer after first trigger (one-shot animation).
 */

import { useEffect, useRef, useState } from 'react'

export default function ScrollReveal({
  children,
  className  = '',
  delay      = 0,
  threshold  = 0.12,
}: {
  children:   React.ReactNode
  className?: string
  delay?:     number        // ms delay before animating
  threshold?: number        // 0–1, how much of element must be visible
}) {
  const ref     = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    shown ? 1 : 0,
        transform:  shown ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}
