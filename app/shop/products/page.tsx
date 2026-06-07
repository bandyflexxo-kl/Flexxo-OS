import { prisma }             from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import ProductsClientPage     from '@/components/shop/ProductsClientPage'
import HeroSection            from '@/components/shop/HeroSection'

/**
 * ShopProductsPage — server wrapper.
 * Renders HeroSection (Condition 17) above the client-side product grid.
 * Category list is fetched server-side; products are loaded client-side for instant filtering.
 */
export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session  = await getOptionalSession()
  const isB2B    = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams

  const categories = await prisma.productCategory.findMany({
    where:   { isActive: true },
    orderBy: { name: 'asc' },
    select:  { id: true, name: true },
  })

  return (
    <>
      {/* Condition 17: full-width hero with tagline + CTA + entry animation */}
      <HeroSection isB2B={isB2B} />

      {/* Product grid with category sidebar/pills */}
      <ProductsClientPage
        categories={categories}
        initialCategoryId={categoryId}
        initialQ={q}
        isB2B={isB2B}
      />
    </>
  )
}
