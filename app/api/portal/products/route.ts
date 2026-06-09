import { unstable_cache } from 'next/cache'
import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, calculateRetailPrice, roundPrice } from '@/lib/pricing'
import { calcDisplayPrice } from '@/lib/qnePriceSync'

/**
 * GET /api/portal/products
 * Public endpoint — no login required for browsing.
 * Pricing tier:
 *   Guest / no session  → retail_margin_pct (global, no overrides)
 *   B2B Client          → b2b_margin_pct (with product/category override hierarchy)
 *
 * Performance: the heavy DB query is wrapped in unstable_cache (5-min TTL).
 * Each unique (q, categoryId, pricingTier, limitAll) combination is a
 * separate cache entry, so B2B and retail prices are never mixed.
 * The route handler itself still runs per-request (reads session cookie),
 * but the expensive DB + pricing work only runs at most once every 5 min.
 */

type ProductListItem = {
  id:          string
  name:        string
  brand:       string | null
  unit:        string | null
  qneItemCode: string | null
  category:    { id: string; name: string }
  hasPhoto:    boolean
  sellingPrice: string | null
  currency:    string
}

// ── cached data layer ──────────────────────────────────────────────────────
// Arguments are part of the cache key — each unique combo is cached separately.
const fetchProductsCached = unstable_cache(
  async (
    q:          string | null,
    categoryId: string | null,
    tier:       'retail' | 'b2b',
    limitAll:   boolean,
  ): Promise<ProductListItem[]> => {
    const isB2B = tier === 'b2b'

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
        // ── lean select: only fetch fields used in the listing response ──
        // catalogDescription is intentionally excluded (shown only on detail page).
        // Using select instead of include avoids fetching ~40 unused columns.
        select: {
          id:                  true,
          name:                true,
          brand:               true,
          unit:                true,
          qneItemCode:         true,
          defaultMarginPct:    true,   // needed for B2B price hierarchy fallback
          googleDrivePhotoId:  true,   // → hasPhoto boolean
          qneLastSalePrice:    true,   // QNE last invoice price (priority pricing)
          category: { select: { id: true, name: true, defaultMarginPct: true } },
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

    return products.map(p => {
      // Priority 1: QNE last sale price × 1.20 — same for ALL users (B2B or guest)
      // Priority 2: cost × margin (fallback when QNE price not yet synced)
      const qnePrice   = p.qneLastSalePrice ? Number(p.qneLastSalePrice) : null
      const qneDisplay = calcDisplayPrice(qnePrice)

      let sellingPrice: string | null = null
      if (qneDisplay !== null) {
        sellingPrice = qneDisplay.toString()
      } else {
        const costPrice = p.priceVersions[0]?.costPrice ?? null
        if (costPrice) {
          if (isB2B) {
            sellingPrice = roundPrice(calculateSellingPrice(
              costPrice, p.defaultMarginPct, p.category.defaultMarginPct, b2bMargin,
            )).toString()
          } else {
            sellingPrice = roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
          }
        }
      }

      return {
        id:          p.id,
        name:        p.name,
        brand:       p.brand,
        unit:        p.unit,
        qneItemCode: p.qneItemCode,
        category:    { id: p.category.id, name: p.category.name },
        hasPhoto:    !!p.googleDrivePhotoId,
        sellingPrice,
        currency:    p.priceVersions[0]?.currency ?? 'MYR',
      }
    })
  },
  ['portal-products'],          // cache namespace
  { revalidate: 300 },          // 5-minute TTL
)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getOptionalSession()

  const { searchParams } = new URL(request.url)
  const q          = searchParams.get('q')?.trim() || null
  const categoryId = searchParams.get('categoryId')   || null
  const limitAll   = searchParams.get('limit') === 'all'
  const tier       = session?.role === 'B2B Client' ? 'b2b' : 'retail'

  return Response.json(await fetchProductsCached(q, categoryId, tier, limitAll))
}
