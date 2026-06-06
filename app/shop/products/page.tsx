import { prisma }             from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import ProductsClientPage     from '@/components/shop/ProductsClientPage'

/**
 * ShopProductsPage — thin server wrapper.
 *
 * Previously this page ran a full Prisma query for all products on every
 * category navigation, causing a full server round-trip each time (cold start
 * + DB query + pricing math + HTML serialisation).
 *
 * Now it only fetches the category list (lightweight) and passes the initial
 * URL params to <ProductsClientPage>, which loads ALL products once via
 * /api/portal/products?limit=all and filters client-side from then on.
 * Category switching is therefore instant after the first load.
 */
export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session  = await getOptionalSession()
  const isB2B    = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams

  // Only fetch categories server-side (cheap query — used to pre-render sidebar)
  const categories = await prisma.productCategory.findMany({
    where:   { isActive: true },
    orderBy: { name: 'asc' },
    select:  { id: true, name: true },
  })

  return (
    <ProductsClientPage
      categories={categories}
      initialCategoryId={categoryId}
      initialQ={q}
      isB2B={isB2B}
    />
  )
}
