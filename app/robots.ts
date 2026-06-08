/**
 * T8-4: robots.txt — allow shop pages, block internal CRM routes.
 * Generated via Next.js Metadata API (no static file needed).
 */
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://flexxo.com.my'

  return {
    rules: [
      {
        // Block CRM (internal staff routes) from indexing
        userAgent: '*',
        disallow: [
          '/',              // CRM dashboard (default route)
          '/companies',
          '/contacts',
          '/pipeline',
          '/quotations',
          '/orders',
          '/reports',
          '/warehouse',
          '/admin',
          '/api/',
          '/shop/cart',
          '/shop/account',
          '/shop/quotations',
          '/shop/orders',
          '/login',
        ],
        allow: [
          '/shop/',
          '/shop/products',
          '/shop/products/',
          '/shop/login',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
