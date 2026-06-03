import { prisma } from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'
import ProductCard from '@/components/shop/ProductCard'
import Link from 'next/link'

export default async function ShopProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string }>
}) {
  const session  = await getOptionalSession()
  const isB2B    = session?.role === 'B2B Client'
  const { q, categoryId } = await searchParams

  const [products, categories, retailSetting, b2bSetting] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive:             true,
        isVisibleToCustomers: true,
        ...(q ? {
          OR: [
            { name:  { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      include: {
        category:      { select: { id: true, name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true },
        },
      },
      orderBy: { name: 'asc' },
      take:    200,
    }),
    prisma.productCategory.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'retail_margin_pct' } }),
    prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } }),
  ])

  const retailMargin = retailSetting?.value ?? '30'
  const b2bMargin    = b2bSetting?.value    ?? '20'

  const rows = products.map(p => {
    const costPrice = p.priceVersions[0]?.costPrice ?? null
    let sellingPrice: string | null = null
    if (costPrice) {
      sellingPrice = isB2B
        ? roundPrice(calculateSellingPrice(costPrice, p.defaultMarginPct, p.category.defaultMarginPct, b2bMargin)).toString()
        : roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
    }
    return {
      id:           p.id,
      name:         p.name,
      brand:        p.brand,
      unit:         p.unit,
      categoryName: p.category.name,
      sellingPrice,
      currency:     p.priceVersions[0]?.currency ?? 'MYR',
      hasPhoto:     !!p.googleDrivePhotoId,
    }
  })

  return (
    <div className="flex gap-8">
      {/* Category sidebar */}
      <aside className="w-48 shrink-0">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Categories</h2>
        <nav className="space-y-0.5">
          <Link
            href="/shop/products"
            className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
              !categoryId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            All Products
          </Link>
          {categories.map(cat => (
            <Link
              key={cat.id}
              href={`/shop/products?categoryId=${cat.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                categoryId === cat.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Search */}
        <form method="GET" className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search products…"
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
          />
          {categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
          <button type="submit" className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors">
            Search
          </button>
          {(q || categoryId) && (
            <Link href="/shop/products" className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 flex items-center transition-colors">
              Clear
            </Link>
          )}
        </form>

        {/* B2B price badge */}
        {isB2B && (
          <div className="inline-flex items-center gap-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
            ✓ B2B pricing applied
          </div>
        )}

        {/* Results count */}
        <p className="text-sm text-gray-500">
          {rows.length.toLocaleString()} product{rows.length !== 1 ? 's' : ''}
          {q && <> matching &ldquo;<strong>{q}</strong>&rdquo;</>}
        </p>

        {/* Grid */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center">
            <p className="text-gray-400 text-sm">No products found.</p>
            <Link href="/shop/products" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
              View all products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {rows.map(p => (
              <ProductCard key={p.id} {...p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
