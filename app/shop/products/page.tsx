import { prisma }                 from '@/lib/prisma'
import { getOptionalShopSession } from '@/lib/session'
import ProductsClientPage         from '@/components/shop/ProductsClientPage'
import HeroSection                from '@/components/shop/HeroSection'

/**
 * ShopProductsPage — server wrapper.
 *
 * Categories are fetched server-side (fast, ~75 rows).
 * Products are fetched client-side via /api/portal/products-public or
 * /api/portal/products — this avoids Supabase connection-pool contention
 * during SSR when many photo API calls run in parallel on first compile.
 */
export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session = await getOptionalShopSession()
  const isB2B   = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams

  const categories = await prisma.productCategory.findMany({
    where:   { isActive: true },
    orderBy: { name: 'asc' },
    select:  { id: true, name: true, parentCategoryId: true },
  })

  return (
    <>
      <HeroSection isB2B={isB2B} />
      <ProductsClientPage
        categories={categories}
        initialCategoryId={categoryId}
        initialQ={q}
        isB2B={isB2B}
      />
    </>
  )
}
