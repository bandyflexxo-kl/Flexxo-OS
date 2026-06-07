import { unstable_cache } from 'next/cache'
import { prisma }          from '@/lib/prisma'
import { calculateRetailPrice, roundPrice } from '@/lib/pricing'

/**
 * GET /api/portal/products-public
 *
 * Public product listing — retail prices only, NO session required.
 *
 * Unlike /api/portal/products (which reads cookies to detect B2B sessions),
 * this route uses NO Next.js dynamic APIs. That means Vercel's edge CDN
 * can ISR-cache each unique URL for 5 minutes — serving cache hits from the
 * edge in ~50–100 ms instead of running a full DB query every request.
 *
 * Used by: guest visitors + internal staff browsing the shop.
 * B2B clients continue to use /api/portal/products (dynamic, B2B pricing).
 */

// Tell Vercel's edge CDN: ISR-cache each unique URL for 5 minutes.
// Keyed by full URL path+query — ?limit=all, ?q=paper, ?categoryId=xyz all
// get independent cache entries. Cache is invalidated every 300 s.
export const revalidate = 300

// ── Types ──────────────────────────────────────────────────────────────────

type ProductListItem = {
  id:           string
  name:         string
  brand:        string | null
  unit:         string | null
  qneItemCode:  string | null
  category:     { id: string; name: string }
  hasPhoto:     boolean
  sellingPrice: string | null
  currency:     string
}

// ── Cached data layer ──────────────────────────────────────────────────────
// unstable_cache acts as a secondary in-process cache (5-min TTL).
// On Vercel, the primary cache is the edge CDN (export const revalidate above).
// On localhost / cold CDN misses, unstable_cache prevents redundant DB queries
// within the same function instance.

const fetchRetailProductsCached = unstable_cache(
  async (
    q:          string | null,
    categoryId: string | null,
    limitAll:   boolean,
  ): Promise<ProductListItem[]> => {
    const [products, retailSetting] = await Promise.all([
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
        select: {
          id:                 true,
          name:               true,
          brand:              true,
          unit:               true,
          qneItemCode:        true,
          googleDrivePhotoId: true,
          category: { select: { id: true, name: true } },
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
    ])

    const retailMargin = retailSetting?.value ?? '30'

    return products.map(p => {
      const costPrice = p.priceVersions[0]?.costPrice ?? null
      const sellingPrice = costPrice
        ? roundPrice(calculateRetailPrice(costPrice, retailMargin)).toString()
        : null

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
  ['portal-products-public'],   // cache namespace (separate from B2B cache)
  { revalidate: 300 },
)

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q          = searchParams.get('q')?.trim() || null
  const categoryId = searchParams.get('categoryId') || null
  const limitAll   = searchParams.get('limit') === 'all'

  return Response.json(await fetchRetailProductsCached(q, categoryId, limitAll))
}
