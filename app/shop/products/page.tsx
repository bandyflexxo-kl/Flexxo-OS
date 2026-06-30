import { prisma }                 from '@/lib/prisma'
import { getOptionalShopSession } from '@/lib/session'
import { fetchProductsCached }    from '@/lib/products-api'
import ProductsClientPage         from '@/components/shop/ProductsClientPage'

/**
 * ShopProductsPage — server wrapper.
 *
 * Both categories and products are fetched in parallel server-side.
 * Products come from the Redis cache (24h TTL) — fast once warm (~200ms).
 * Embedding them in the RSC payload means the browser renders products
 * immediately with the initial HTML, with no separate client-side API call.
 *
 * Note: previously products were client-fetched to avoid Supabase pool
 * contention during Turbopack compilation. Now that Redis is configured,
 * the SSR path hits Redis (not Supabase directly) so contention is gone.
 */
export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session = await getOptionalShopSession()
  const isB2B   = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams

  const [categories, initialProducts] = await Promise.all([
    prisma.productCategory.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, parentCategoryId: true },
    }),
    fetchProductsCached(isB2B ? 'b2b' : 'retail'),
  ])

  return (
    <>
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
