import { prisma }             from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'
import CartButton             from '@/components/shop/CartButton'
import ProductCard            from '@/components/shop/ProductCard'
import Link                   from 'next/link'
import { notFound }           from 'next/navigation'

export default async function ShopProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id }  = await params
  const session = await getOptionalSession()
  const isB2B   = session?.role === 'B2B Client'

  const [product, retailSetting, b2bSetting] = await Promise.all([
    prisma.product.findUnique({
      where: { id, isActive: true, isVisibleToCustomers: true },
      include: {
        category:      { select: { id: true, name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true, minOrderQty: true, unit: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'retail_margin_pct' } }),
    prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } }),
  ])

  if (!product) notFound()

  const retailMargin = retailSetting?.value ?? '30'
  const b2bMargin    = b2bSetting?.value    ?? '20'
  const costPrice    = product.priceVersions[0]?.costPrice ?? null
  const currency     = product.priceVersions[0]?.currency  ?? 'MYR'
  const minOrderQty  = product.priceVersions[0]?.minOrderQty ?? 1
  const unit         = product.priceVersions[0]?.unit ?? product.unit

  let sellingPrice: string | null = null
  if (costPrice) {
    sellingPrice = isB2B
      ? roundPrice(calculateSellingPrice(costPrice, product.defaultMarginPct, product.category.defaultMarginPct, b2bMargin)).toString()
      : roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
  }

  // Related products — same category, exclude self, up to 4
  const relatedRaw = await prisma.product.findMany({
    where: {
      categoryId:           product.category.id,
      id:                   { not: product.id },
      isActive:             true,
      isVisibleToCustomers: true,
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
    take: 4,
  })

  const relatedProducts = relatedRaw.map(p => {
    const cp = p.priceVersions[0]?.costPrice ?? null
    let sp: string | null = null
    if (cp) {
      sp = isB2B
        ? roundPrice(calculateSellingPrice(cp, p.defaultMarginPct, p.category.defaultMarginPct, b2bMargin)).toString()
        : roundPrice(calculateRetailPrice(cp, retailMargin)).toString()
    }
    return {
      id:           p.id,
      name:         p.name,
      brand:        p.brand,
      unit:         p.unit,
      categoryName: p.category.name,
      sellingPrice: sp,
      currency:     p.priceVersions[0]?.currency ?? 'MYR',
      hasPhoto:     !!p.googleDrivePhotoId,
    }
  })

  const loginUrl = `/shop/login?returnUrl=${encodeURIComponent(`/shop/products/${id}`)}`

  return (
    <div className="space-y-10">

      {/* ── Breadcrumb ──────────────────────────────────────── */}
      <nav className="flex items-center gap-2 text-sm text-gray-400" aria-label="Breadcrumb">
        <Link href="/shop/products" className="hover:text-gray-600 transition-colors">
          Products
        </Link>
        <span>›</span>
        <Link
          href={`/shop/products?categoryId=${product.category.id}`}
          className="hover:text-gray-600 transition-colors"
        >
          {product.category.name}
        </Link>
        <span>›</span>
        <span className="text-gray-600 truncate max-w-xs">{product.name}</span>
      </nav>

      {/* ── Main product card ──────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">

          {/* Photo — takes 3/5 width on large screens */}
          <div className="lg:col-span-3 aspect-square bg-gray-50 flex items-center justify-center p-8 sm:border-b lg:border-b-0 sm:border-r-0 lg:border-r border-gray-100 relative overflow-hidden group">
            {product.googleDrivePhotoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/portal/photo/${product.id}`}
                alt={product.name}
                className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="text-9xl text-gray-200 select-none">📦</div>
            )}
            {/* Category chip on photo */}
            <div className="absolute top-4 left-4">
              <Link
                href={`/shop/products?categoryId=${product.category.id}`}
                className="bg-white/90 backdrop-blur-sm text-green-600 text-xs font-semibold px-3 py-1 rounded-full border border-green-100 hover:bg-white transition-colors shadow-sm"
              >
                {product.category.name}
              </Link>
            </div>
          </div>

          {/* Details — takes 2/5 width on large screens */}
          <div className="lg:col-span-2 p-7 lg:p-8 flex flex-col gap-5">

            {/* Title */}
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-snug">{product.name}</h1>
              {product.brand && (
                <p className="text-sm text-gray-500 mt-1.5 font-medium">{product.brand}</p>
              )}
            </div>

            {/* Description */}
            {(product.catalogDescription ?? product.packDescription) && (
              <p className="text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
                {product.catalogDescription ?? product.packDescription}
              </p>
            )}

            {/* Specs table */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-gray-100 pt-4">
              {product.qneItemCode && (
                <>
                  <dt className="text-gray-400">Item Code</dt>
                  <dd className="font-mono text-gray-700 text-xs truncate">{product.qneItemCode}</dd>
                </>
              )}
              {unit && (
                <>
                  <dt className="text-gray-400">Unit</dt>
                  <dd className="text-gray-700">{unit}</dd>
                </>
              )}
              {product.packDescription && product.catalogDescription && (
                <>
                  <dt className="text-gray-400">Pack</dt>
                  <dd className="text-gray-700 text-xs">{product.packDescription}</dd>
                </>
              )}
              {minOrderQty > 1 && (
                <>
                  <dt className="text-gray-400">Min. Order</dt>
                  <dd className="text-gray-700 font-medium">{minOrderQty} {unit ?? ''}</dd>
                </>
              )}
            </dl>

            {/* Price */}
            <div className="border-t border-gray-100 pt-4">
              {sellingPrice ? (
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-extrabold text-gray-900 tracking-tight">
                      {currency} {Number(sellingPrice).toFixed(2)}
                    </p>
                    {unit && <span className="text-sm text-gray-400 font-normal">/ {unit}</span>}
                  </div>
                  {isB2B ? (
                    <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      B2B price applied
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">
                      <Link href={loginUrl} className="text-green-600 hover:underline">Sign in</Link>
                      {' '}for B2B pricing
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-lg text-gray-400 italic">Price on request</p>
                  <p className="text-xs text-gray-400">Contact your Flexxo sales rep for pricing.</p>
                </div>
              )}
            </div>

            {/* Cart button */}
            <CartButton
              productId={product.id}
              minOrderQty={minOrderQty}
              isLoggedIn={isB2B}
              loginUrl={loginUrl}
            />
          </div>
        </div>
      </div>

      {/* ── Related products ───────────────────────────────── */}
      {relatedProducts.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              More from {product.category.name}
            </h2>
            <Link
              href={`/shop/products?categoryId=${product.category.id}`}
              className="text-sm text-green-600 hover:text-green-700 hover:underline transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {relatedProducts.map(p => (
              <ProductCard key={p.id} {...p} isB2B={isB2B} />
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
