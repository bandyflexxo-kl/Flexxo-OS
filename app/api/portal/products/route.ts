import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'

/**
 * GET /api/portal/products
 * Public endpoint — no login required for browsing.
 * Pricing tier:
 *   Guest / no session  → retail_margin_pct (global, no overrides)
 *   B2B Client          → b2b_margin_pct (with product/category override hierarchy)
 */
export async function GET(request: Request) {
  const session = await getOptionalSession()

  const { searchParams } = new URL(request.url)
  const q          = searchParams.get('q')?.trim()
  const categoryId = searchParams.get('categoryId')

  const isB2B = session?.role === 'B2B Client'

  // ?limit=all skips the 200-item cap — used by the client-side product browser
  // which loads everything once and filters in-browser for instant category switching.
  const limitAll = searchParams.get('limit') === 'all'

  const [products, retailSetting, b2bSetting] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive:             true,
        isVisibleToCustomers: true,
        ...(q ? {
          OR: [
            { name:        { contains: q, mode: 'insensitive' } },
            { brand:       { contains: q, mode: 'insensitive' } },
            { qneItemCode: { contains: q, mode: 'insensitive' } },
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
      ...(limitAll ? {} : { take: 200 }),
    }),
    prisma.systemSetting.findUnique({ where: { key: 'retail_margin_pct' } }),
    prisma.systemSetting.findUnique({ where: { key: 'b2b_margin_pct' } }),
  ])

  const retailMargin = retailSetting?.value ?? '30'
  const b2bMargin    = b2bSetting?.value    ?? '20'

  return Response.json(products.map(p => {
    const costPrice = p.priceVersions[0]?.costPrice ?? null
    let sellingPrice: string | null = null

    if (costPrice) {
      if (isB2B) {
        // B2B price: uses product/category/global hierarchy
        sellingPrice = roundPrice(calculateSellingPrice(
          costPrice, p.defaultMarginPct, p.category.defaultMarginPct, b2bMargin,
        )).toString()
      } else {
        // Retail price: global only, no overrides
        sellingPrice = roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
      }
    }

    return {
      id:                 p.id,
      name:               p.name,
      brand:              p.brand,
      unit:               p.unit,
      qneItemCode:        p.qneItemCode,
      category:           { id: p.category.id, name: p.category.name },
      catalogDescription: p.catalogDescription,
      hasPhoto:           !!p.googleDrivePhotoId,
      sellingPrice,
      currency:           p.priceVersions[0]?.currency ?? 'MYR',
    }
  }))
}
