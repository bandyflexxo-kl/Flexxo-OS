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
import type { Metadata }      from 'next'

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
 * T8-5: JSON-LD Product schema for search engine rich results
 * T8-11: WhatsApp share button on product detail
 */

// T8-5: Per-page metadata
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const product = await prisma.product.findUnique({
    where:  { id, isActive: true, isVisibleToCustomers: true },
    select: { name: true, brand: true, catalogDescription: true, packDescription: true },
  })
  if (!product) return { title: 'Product Not Found' }

  const description = product.catalogDescription
    ?? product.packDescription
    ?? `${product.brand ? `${product.brand} ` : ''}${product.name} — available at Flexxo Shop.`

  return {
    title:       `${product.name}${product.brand ? ` | ${product.brand}` : ''}`,
    description: description.slice(0, 160),
    openGraph: {
      title:       product.name,
      description: description.slice(0, 160),
    },
  }
}

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

  const baseUrl    = process.env.NEXTAUTH_URL ?? 'https://flexxo.com.my'
  const productUrl = `${baseUrl}/shop/products/${id}`

  // T8-5: JSON-LD Product schema
  const jsonLd = {
    '@context':   'https://schema.org',
    '@type':      'Product',
    name:          product.name,
    ...(product.brand && { brand: { '@type': 'Brand', name: product.brand } }),
    ...(product.catalogDescription && { description: product.catalogDescription }),
    ...(product.qneItemCode && { sku: product.qneItemCode }),
    ...(product.googleDrivePhotoId && { image: `${baseUrl}/api/portal/photo/${id}` }),
    offers: {
      '@type':       'Offer',
      url:            productUrl,
      priceCurrency: currency,
      availability:  'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'Flexxo (KL) Sdn Bhd' },
    },
  }

  // T8-11: WhatsApp share URL
  const waShareText = encodeURIComponent(
    `Check out ${product.name} from Flexxo Shop:\n${productUrl}`
  )
  const waShareUrl = `https://wa.me/?text=${waShareText}`

  return (
    <div className="space-y-8 sm:space-y-10">

      {/* T8-5: JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

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

            {/* 3. Price — visible to all users */}
            <div className="border-t border-gray-100 pt-4">
              {sellingPrice ? (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-3xl font-extrabold text-gray-900 tracking-tight">
                      {currency} {Number(sellingPrice).toFixed(2)}
                    </p>
                    {unit && <span className="text-sm text-gray-400 font-normal">/ {unit}</span>}
                  </div>
                  <StockBadge status="in-stock" size="sm" />
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
            {/* No ScrollReveal here — SpecTable is always in the initial viewport.
                ScrollReveal's opacity:0 initial state caused black blocks on page load. */}
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

            {/* 6. Add-to-cart CTA — Condition 15: qty +/- stepper */}
            <CartButton
              productId={product.id}
              minOrderQty={minOrderQty}
              isLoggedIn={isB2B}
              loginUrl={loginUrl}
            />

            {/* 7. Trust signals — Condition 13 */}
            {/* No ScrollReveal — TrustBadge is always in the initial viewport.
                Removing ScrollReveal prevents opacity:0 flash (black block) on load. */}
            <TrustBadge />

            {/* T8-11: WhatsApp share button */}
            <div className="flex items-center gap-2 pt-1">
              <a
                href={waShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-green-600 transition-colors"
                aria-label="Share this product on WhatsApp"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Share on WhatsApp
              </a>
            </div>

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

      {/* Mobile bottom spacer — prevents content hiding behind StickyCartBar (≈60px)
          which sits at bottom-14 (56px) above ShopBottomNav. Layout already adds
          pb-20 for the nav; this adds the extra clearance for the cart bar. */}
      <div className="h-16 sm:hidden" aria-hidden="true" />

    </div>
  )
}
