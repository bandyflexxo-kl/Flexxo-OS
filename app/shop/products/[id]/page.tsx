import { prisma } from '@/lib/prisma'
import { getOptionalSession } from '@/lib/session'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'
import CartButton from '@/components/shop/CartButton'
import Link from 'next/link'
import { notFound } from 'next/navigation'

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

  const loginUrl = `/shop/login?returnUrl=${encodeURIComponent(`/shop/products/${id}`)}`

  return (
    <div className="max-w-4xl">
      <Link href="/shop/products" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1 transition-colors">
        ← Back to Products
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {/* Photo */}
          <div className="aspect-square bg-gray-50 flex items-center justify-center p-8 border-b sm:border-b-0 sm:border-r border-gray-100">
            {product.googleDrivePhotoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/portal/photo/${product.id}`}
                alt={product.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-8xl text-gray-200">📦</div>
            )}
          </div>

          {/* Details */}
          <div className="p-8 space-y-5">
            <div>
              <Link
                href={`/shop/products?categoryId=${product.category.id}`}
                className="text-xs font-semibold text-blue-600 uppercase tracking-wide hover:underline"
              >
                {product.category.name}
              </Link>
              <h1 className="text-xl font-bold text-gray-900 mt-1 leading-snug">{product.name}</h1>
              {product.brand && <p className="text-sm text-gray-500 mt-1">{product.brand}</p>}
            </div>

            {product.catalogDescription && (
              <p className="text-sm text-gray-600 leading-relaxed">{product.catalogDescription}</p>
            )}

            {/* Product details */}
            <div className="space-y-2 text-sm">
              {product.qneItemCode && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Item Code</span>
                  <span className="font-mono text-gray-700 text-xs">{product.qneItemCode}</span>
                </div>
              )}
              {unit && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Unit</span>
                  <span className="text-gray-700">{unit}</span>
                </div>
              )}
              {minOrderQty > 1 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Min. Order</span>
                  <span className="text-gray-700">{minOrderQty} {unit ?? ''}</span>
                </div>
              )}
            </div>

            {/* Price */}
            <div className="py-4 border-t border-gray-100">
              {sellingPrice ? (
                <div className="space-y-1">
                  <p className="text-3xl font-bold text-gray-900">
                    {currency} {Number(sellingPrice).toFixed(2)}
                    {unit && <span className="text-base font-normal text-gray-400 ml-1">/ {unit}</span>}
                  </p>
                  {isB2B && (
                    <p className="text-xs text-green-600 font-medium">✓ B2B price</p>
                  )}
                </div>
              ) : (
                <p className="text-base text-gray-400 italic">Price on request</p>
              )}
            </div>

            <CartButton
              productId={product.id}
              minOrderQty={minOrderQty}
              isLoggedIn={isB2B}
              loginUrl={loginUrl}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
