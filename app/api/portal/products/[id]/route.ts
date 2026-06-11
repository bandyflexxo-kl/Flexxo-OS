import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'

/**
 * GET /api/portal/products/[id]
 * Public endpoint — no login required.
 * Returns retail price for guests, B2B price for logged-in B2B clients.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  const { id }  = await params
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

  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  const retailMargin = retailSetting?.value ?? '30'
  const b2bMargin    = b2bSetting?.value    ?? '20'
  const costPrice    = product.priceVersions[0]?.costPrice ?? null

  let sellingPrice: string | null = null
  if (costPrice) {
    if (isB2B) {
      sellingPrice = roundPrice(calculateSellingPrice(
        costPrice, product.defaultMarginPct, product.category.defaultMarginPct, b2bMargin,
      )).toString()
    } else {
      sellingPrice = roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
    }
  }

  return Response.json({
    id:                 product.id,
    name:               product.name,
    brand:              product.brand,
    unit:               product.priceVersions[0]?.unit ?? product.unit,
    packDescription:    product.packDescription,
    qneItemCode:        product.qneItemCode,
    category:           { id: product.category.id, name: product.category.name },
    catalogDescription: product.catalogDescription,
    hasPhoto:           !!product.googleDrivePhotoId,
    sellingPrice,
    currency:           product.priceVersions[0]?.currency ?? 'MYR',
    minOrderQty:        product.priceVersions[0]?.minOrderQty ?? 1,
    isB2B,
  })
}
