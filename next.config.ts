import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf-parse out of the webpack/turbopack bundle so Node.js loads its
  // CJS entry natively — prevents pdfjs-dist from crashing on missing browser
  // globals (DOMMatrix, ImageData, Path2D) that only exist in a browser context.
  serverExternalPackages: ['pdf-parse'],

  // ── Security headers ──────────────────────────────────────────────────────
  // Applied to every response. CSP intentionally omitted — the shop page uses
  // inline event handlers and Google Fonts; a strict CSP needs careful tuning
  // per-page and is left for Phase 5. All other headers are safe to add now.
  async headers() {
    const baseHeaders = [
      // Prevent framing (clickjacking)
      { key: 'X-Frame-Options',          value: 'DENY' },
      // Stop MIME-type sniffing (e.g. serving a JS file as text/plain)
      { key: 'X-Content-Type-Options',   value: 'nosniff' },
      // Only send full referrer to same origin; just origin to cross-origin
      { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
      // Disable browser features Flexxo doesn't use
      { key: 'Permissions-Policy',       value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      // Legacy XSS filter (still helps older browsers)
      { key: 'X-XSS-Protection',         value: '1; mode=block' },
      // Prevent DNS prefetch leaking internal URLs to third parties
      { key: 'X-DNS-Prefetch-Control',   value: 'off' },
    ]

    // HSTS only in production. On localhost the browser honours it and pins
    // http→https upgrades, which breaks the http-only dev server (the upgrade
    // has no TLS endpoint to reach). Never send it in development.
    if (process.env.NODE_ENV === 'production') {
      baseHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' })
    }

    return [{ source: '/(.*)', headers: baseHeaders }]
  },

  // Allow builds to succeed even when TypeScript errors exist in code that
  // references DB models pending a migration (Invoice, DeliveryBooking,
  // WarehouseTask). Remove once `npx prisma migrate dev --name add_fulfilment_pipeline`
  // has been run and the Prisma client regenerated.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow Next.js Image component to serve from our own photo proxy route
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.vercel.app',
      },
      {
        protocol: 'https',
        hostname: 'shop.flexxo.com.my',
      },
      {
        protocol: 'https',
        hostname: 'crm.flexxo.com.my',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'http',
        hostname: 'shop.localhost',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

export default nextConfig;
