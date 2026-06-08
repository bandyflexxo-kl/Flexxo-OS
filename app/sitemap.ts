/**
 * T8-3: sitemap.xml — shop product pages only (CRM routes excluded).
 * Dynamically generated: pulls active, visible products from DB.
 * Revalidates every 12 hours (ISR-friendly).
 */
import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'

export const revalidate = 43200 // 12 hours

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://flexxo.com.my'

  // Static shop routes
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url:              `${baseUrl}/shop/products`,
      lastModified:     new Date(),
      changeFrequency:  'daily',
      priority:         0.9,
    },
    {
      url:              `${baseUrl}/shop/login`,
      lastModified:     new Date(),
      changeFrequency:  'monthly',
      priority:         0.5,
    },
  ]

  // Dynamic product detail pages — only visible products
  let productRoutes: MetadataRoute.Sitemap = []
  try {
    const products = await prisma.product.findMany({
      where:   { isActive: true, isVisibleToCustomers: true },
      select:  { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    5000, // safety cap
    })

    productRoutes = products.map(p => ({
      url:             `${baseUrl}/shop/products/${p.id}`,
      lastModified:    p.createdAt,
      changeFrequency: 'weekly' as const,
      priority:        0.7,
    }))
  } catch (err) {
    // DB unavailable at build time — return static routes only
    console.error('[sitemap] DB fetch failed — omitting product routes:', err)
  }

  return [...staticRoutes, ...productRoutes]
}
