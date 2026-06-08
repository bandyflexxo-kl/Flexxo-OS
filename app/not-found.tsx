/**
 * T8-9: Custom 404 page — on-brand, with useful recovery links.
 *
 * Covers both /shop/* and CRM routes.
 * G-3: explicit bg-white — never transparent.
 */
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found — Flexxo',
}

export default function NotFound() {
  return (
    /* G-3: explicit background */
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16 text-center">

      {/* Flexxo branding */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/flexxo-logo.png"
        alt="Flexxo"
        width={140}
        height={44}
        className="h-11 w-auto mx-auto object-contain mb-8 opacity-80"
      />

      {/* 404 badge */}
      <div
        className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6"
        style={{ backgroundColor: '#f0fdf4' }} /* green-50 explicit */
      >
        <span className="text-4xl">🔍</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
        Page not found
      </h1>
      <p className="text-gray-500 text-sm sm:text-base max-w-sm mb-8 leading-relaxed">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
        Let&apos;s get you back on track.
      </p>

      {/* Recovery links */}
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-sm">
        <Link
          href="/shop/products"
          className="flex-1 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition-colors text-center"
        >
          Browse Products
        </Link>
        <Link
          href="/shop/login"
          className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors text-center"
        >
          Sign In
        </Link>
      </div>

      <p className="mt-8 text-xs text-gray-400">
        Need help?{' '}
        <a
          href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? '60123456789'}?text=${encodeURIComponent("Hi Flexxo! I need some help.")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-green-600 hover:underline"
        >
          Chat with us on WhatsApp
        </a>
      </p>
    </div>
  )
}
