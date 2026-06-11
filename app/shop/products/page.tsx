import { prisma }               from '@/lib/prisma'
import { getOptionalShopSession }   from '@/lib/session'
import { fetchProductsCached }  from '@/lib/products-api'
import ProductsClientPage       from '@/components/shop/ProductsClientPage'
import HeroSection              from '@/components/shop/HeroSection'

/**
 * ShopProductsPage — server wrapper.
 *
 * Products are now fetched server-side (SSR) from the Redis-backed cache and
 * passed as `initialProducts` to ProductsClientPage. The client component uses
 * them immediately on mount — no "Loading catalogue…" spinner ever appears.
 *
 * Cache strategy: Redis (24h) → unstable_cache fallback → DB.
 * All filtering (category, search) remains client-side for instant UX.
 */
export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session = await getOptionalShopSession()
  const isB2B   = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams
  const tier = isB2B ? 'b2b' : 'retail'

  // Fetch categories + products in parallel — products come from Redis cache
  const [categories, initialProducts] = await Promise.all([
    prisma.productCategory.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    }),
    fetchProductsCached(tier),
  ])

  return (
    <>
      {/* Condition 17: full-width hero with tagline + CTA + entry animation */}
      <HeroSection isB2B={isB2B} />

      {/* Product grid — initialProducts means no loading spinner on mount */}
      <ProductsClientPage
        categories={categories}
        initialProducts={initialProducts}
        initialCategoryId={categoryId}
        initialQ={q}
        isB2B={isB2B}
      />
    </>
  )
}
