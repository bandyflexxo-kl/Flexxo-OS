import { prisma }             from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'
import CartButton             from '@/components/shop/CartButton'
import ProductCard            from '@/components/shop/ProductCard'
import TrustBadge             from '@/components/shop/TrustBadge'
import StockBadge             from '@/components/shop/StockBadge'
import SpecTable              from '@/components/shop/SpecTable'
import StickyCartBar          from '@/components/shop/StickyCartBar'
import ScrollReveal           from '@/components/shop/ScrollReveal'
import Link                   from 'next/link'
import { notFound }           from 'next/navigation'

/**
 * ShopProductDetailPage — premium product detail with 7 conversion elements.
 *
 * Condition 20: StickyCartBar (mobile only)
 * Condition 21: 7 elements — image, name, price, desc, specs, CTA, trust
 * Condition 22: SpecTable with SKU, brand, category, unit
 * Condition 13: TrustBadge below CTA
 * Condition 14: StockBadge beside price
 * Condition 15: qty stepper in CartButton
 * Condition 19: ScrollReveal on SpecTable + related products sections
 */
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

  const stockStatus = sellingPrice ? 'in-stock' as const : 'available' as const

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
    <div className="space-y-8 sm:space-y-10">

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

      {/* ── Main product card — 7 conversion elements ─────── */}
      {/* Condition 21: image, name, price, description, specs, CTA, trust */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">

          {/* 1. Product image */}
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
            {/* StockBadge on image — Condition 14 */}
            <div className="absolute top-4 right-4">
              <StockBadge status={stockStatus} size="sm" />
            </div>
          </div>

          {/* Details panel */}
          <div className="lg:col-span-2 p-6 sm:p-7 lg:p-8 flex flex-col gap-5">

            {/* 2. Product name */}
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-snug">{product.name}</h1>
              {product.brand && (
                <p className="text-sm text-gray-500 mt-1 font-medium">{product.brand}</p>
              )}
            </div>

            {/* 3. Price — Condition 14: StockBadge beside price */}
            <div className="border-t border-gray-100 pt-4">
              {sellingPrice ? (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-3xl font-extrabold text-gray-900 tracking-tight">
                      {currency} {Number(sellingPrice).toFixed(2)}
                    </p>
                    {unit && <span className="text-sm text-gray-400 font-normal">/ {unit}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StockBadge status="in-stock" size="sm" />
                    {isB2B ? (
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                        B2B price applied
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">
                        <Link href={loginUrl} className="text-green-600 hover:underline">Sign in</Link>
                        {' '}for B2B pricing
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-lg text-gray-400 italic">Price on request</p>
                  <div className="flex items-center gap-2">
                    <StockBadge status="available" size="sm" />
                    <p className="text-xs text-gray-400">Contact your Flexxo sales rep for pricing.</p>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Description */}
            {(product.catalogDescription ?? product.packDescription) && (
              <p className="text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
                {product.catalogDescription ?? product.packDescription}
              </p>
            )}

            {/* 5. Specifications — Condition 22: SKU, brand, category, unit */}
            <ScrollReveal>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
                  Specifications
                </p>
                <SpecTable specs={[
                  { label: 'SKU',       value: product.qneItemCode,   mono: true },
                  { label: 'Brand',     value: product.brand                      },
                  { label: 'Category',  value: product.category.name              },
                  { label: 'Unit',      value: unit                               },
                  { label: 'Min. Order',value: minOrderQty > 1 ? `${minOrderQty} ${unit ?? ''}`.trim() : null },
                  { label: 'Pack',      value: (product.packDescription && product.catalogDescription) ? product.packDescription : null },
                ]} />
              </div>
            </ScrollReveal>

            {/* 6. Add-to-cart CTA — Condition 15: qty +/- stepper */}
            <CartButton
              productId={product.id}
              minOrderQty={minOrderQty}
              isLoggedIn={isB2B}
              loginUrl={loginUrl}
            />

            {/* 7. Trust signals — Condition 13 */}
            <ScrollReveal delay={100}>
              <TrustBadge />
            </ScrollReveal>

          </div>
        </div>
      </div>

      {/* ── Related products — Condition 19 (scroll-triggered) ── */}
      {relatedProducts.length > 0 && (
        <ScrollReveal>
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
        </ScrollReveal>
      )}

      {/* ── Sticky mobile cart bar — Condition 20 ─────────── */}
      <StickyCartBar
        productId={product.id}
        productName={product.name}
        price={sellingPrice}
        currency={currency}
        unit={unit ?? null}
        minOrderQty={minOrderQty}
        isLoggedIn={isB2B}
        loginUrl={loginUrl}
      />

    </div>
  )
}
