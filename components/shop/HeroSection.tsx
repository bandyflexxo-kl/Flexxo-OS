/**
 * HeroSection — full-width hero shown above the product grid.
 *
 * Condition 17: full-width hero with Flexxo tagline + CTA.
 * Condition 18: entry animation using CSS keyframes (animate-fade-in-up).
 * Animations fire once on mount — CSS `animation-fill-mode: both` ensures
 * elements stay visible after the animation completes.
 */

import Image from 'next/image'
import Link from 'next/link'
import { Z } from '@/constants/zIndex'

export default function HeroSection({ isB2B }: { isB2B: boolean }) {
  return (
    <section
      className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-8 mb-6 sm:mb-8 relative overflow-hidden bg-green-700"
      aria-label="Flexxo Shop hero"
    >
      {/* Green gradient background */}
      <div className="bg-gradient-to-br from-green-900 via-green-800 to-green-700 py-10 sm:py-16 px-4 sm:px-6 relative">

        {/* Dot-grid pattern overlay — purely visual */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="max-w-6xl mx-auto text-center relative" style={{ zIndex: Z.heroContent }}>

          {/* Logo — Fix 1: <Image> reserves layout space (width/height prevent CLS) */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0ms' }}>
            <Image
              src="/flexxo-logo.png"
              alt="Flexxo"
              width={160}
              height={48}
              priority
              className="h-10 sm:h-12 w-auto mx-auto mb-4 object-contain"
            />
          </div>

          {/* Tagline */}
          <h1
            className="text-3xl sm:text-4xl lg:text-5xl font-black text-white leading-tight tracking-tight animate-fade-in-up"
            style={{ animationDelay: '80ms' }}
          >
            Your 1stop Office Partner
          </h1>

          {/* Subtitle */}
          <p
            className="mt-3 text-sm sm:text-base text-green-100 max-w-xl mx-auto animate-fade-in-up"
            style={{ animationDelay: '160ms' }}
          >
            3,700+ quality products — stationery, pantry, hygiene, furniture & more
            for Malaysian corporate buyers.
          </p>

          {/* CTA buttons */}
          <div
            className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in-up"
            style={{ animationDelay: '240ms' }}
          >
            <a
              href="#products-grid"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-white text-green-800 font-semibold rounded-xl text-sm hover:bg-green-50 transition-colors shadow-sm"
            >
              Browse Products
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </a>
            {!isB2B && (
              <Link
                href="/shop/login"
                className="inline-flex items-center gap-2 px-6 py-2.5 border border-white/40 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors"
              >
                Get B2B Account
              </Link>
            )}
            {isB2B && (
              <Link
                href="/shop/quotations"
                className="inline-flex items-center gap-2 px-6 py-2.5 border border-white/40 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors"
              >
                My Quotations
              </Link>
            )}
          </div>

          {/* Trust stats strip — frosted glass cards */}
          <div
            className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4 animate-fade-in-up"
            style={{ animationDelay: '320ms' }}
          >
            {[
              { num: '3,700+', label: 'Products' },
              { num: '10+',    label: 'Categories' },
              { num: 'KL',     label: 'Based & Delivered' },
              { num: 'B2B',    label: 'Corporate Specialists' },
            ].map(({ num, label }) => (
              <div
                key={label}
                className="text-center px-5 py-3 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <p className="text-lg sm:text-xl font-bold text-white">{num}</p>
                <p className="text-[11px] text-green-200 font-medium">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Wave / bottom curve */}
      <svg
        className="w-full text-gray-50 -mt-1 block"
        viewBox="0 0 1440 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 32L1440 0V32H0Z" fill="currentColor"/>
      </svg>
    </section>
  )
}
