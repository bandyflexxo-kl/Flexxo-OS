/**
 * lib/products-api.ts — Shared product catalogue query
 *
 * Used by:
 *   - app/shop/products/page.tsx          (server component — SSR initial data)
 *   - app/api/portal/products/route.ts    (B2B API — browser cache layer)
 *   - app/api/portal/products-public/route.ts (guest API — CDN cache layer)
 *
 * Cache strategy (two-layer):
 *   Layer 1 — Upstash Redis (24h TTL)
 *     • Survives dev server restarts
 *     • Shared across all Vercel serverless instances
 *     • Explicitly invalidated after QNE price sync
 *     • Active when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set
 *
 *   Layer 2 — Next.js unstable_cache (fallback, 24h TTL)
 *     • In-process cache, cleared on server restart
 *     • Active automatically when Redis is not configured
 *
 * Note: the q/categoryId filters are applied CLIENT-SIDE after the full
 * catalogue is loaded. This matches the existing UX (instant filter on client).
 */

import { unstable_cache }                        from 'next/cache'
import { prisma }                                from '@/lib/prisma'
import { tieredSellingPrice, getTierRates }      from '@/lib/tieredPricing'
import { calcDisplayPrice }                      from '@/lib/qnePriceSync'
import { getRedis }                              from '@/lib/redis'

// ── Type ─────────────────────────────────────────────────────────────────────

export type ProductListItem = {
  id:           string
  name:         string
  brand:        string | null
  unit:         string | null
  qneItemCode:  string | null
  barcode:      string | null
  category:     { id: string; name: string }
  hasPhoto:     boolean
  sellingPrice: string | null
  currency:     string
  availableQty: number | null   // QNE stock; null = not yet synced
}

// ── Cache config ──────────────────────────────────────────────────────────────

const TTL_SECONDS = 86_400   // 24 hours
const REDIS_KEY   = (tier: 'retail' | 'b2b') => `flexxo:products:v1:${tier}`

// ── Core DB query (no cache) ──────────────────────────────────────────────────

async function queryProducts(tier: 'retail' | 'b2b'): Promise<ProductListItem[]> {
  const [products, rates] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive:             true,
        isVisibleToCustomers: true,
        // Stock gate: hide only items synced to 0. Never-synced (null) stay visible
        // so the shop isn't emptied before the first QNE stock sync runs.
        OR: [{ qneAvailableQty: null }, { qneAvailableQty: { gt: 0 } }],
      },
      select: {
        id:                  true,
        name:                true,
        brand:               true,
        unit:                true,
        qneItemCode:         true,
        barcode:             true,
        googleDrivePhotoId:  true,
        photoUrl:            true,
        qneLastSalePrice:    true,
        qneAvailableQty:     true,
        customSellingPrice:  true,
        category:            { select: { id: true, name: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true },
        },
      },
      orderBy: { name: 'asc' },
    }),
    getTierRates(),
  ])

  // tier param kept for cache-key separation (retail vs b2b) — pricing is identical
  void tier

  return products.map(p => {
    // Priority 1: customSellingPrice (per-product admin override)
    // Priority 2: tiered gross-margin from supplier cost price
    // Priority 3: QNE last-sale × 1.20 (fallback when no cost price uploaded yet)
    const custom     = p.customSellingPrice ? Number(p.customSellingPrice).toFixed(2) : null
    const costPrice  = p.priceVersions[0]?.costPrice ?? null
    const fromCost   = costPrice ? tieredSellingPrice(costPrice.toNumber(), rates) : null
    const qneDisplay = calcDisplayPrice(p.qneLastSalePrice ? Number(p.qneLastSalePrice) : null)

    const sellingPrice: string | null = custom ?? fromCost ?? (qneDisplay !== null ? qneDisplay.toString() : null)

    return {
      id:           p.id,
      name:         p.name,
      brand:        p.brand,
      unit:         p.unit,
      qneItemCode:  p.qneItemCode,
      barcode:      p.barcode,
      category:     { id: p.category.id, name: p.category.name },
      hasPhoto:     !!p.googleDrivePhotoId || !!p.photoUrl,
      photoUrl:     p.photoUrl ?? null,
      sellingPrice,
      currency:     p.priceVersions[0]?.currency ?? 'MYR',
      availableQty: p.qneAvailableQty ?? null,
    }
  })
}

// ── Fallback: Next.js unstable_cache (when Redis not configured) ─────────────

const _retailCached = unstable_cache(
  () => queryProducts('retail'),
  ['products-api-retail'],
  { revalidate: TTL_SECONDS },
)

const _b2bCached = unstable_cache(
  () => queryProducts('b2b'),
  ['products-api-b2b'],
  { revalidate: TTL_SECONDS },
)

// ── Main export: Redis-first cached fetch ─────────────────────────────────────

/**
 * Fetch the full product catalogue for the given pricing tier.
 *
 * Checks Redis first (24h), falls back to unstable_cache, falls back to DB.
 * Safe to call server-side in both page server components and API routes.
 */
export async function fetchProductsCached(tier: 'retail' | 'b2b'): Promise<ProductListItem[]> {
  const redis = getRedis()

  if (redis) {
    try {
      const cached = await redis.get<ProductListItem[]>(REDIS_KEY(tier))
      if (cached && Array.isArray(cached) && cached.length > 0) return cached
    } catch {
      // Redis read error — fall through to DB (non-fatal)
    }

    try {
      const fresh = await queryProducts(tier)
      // Fire-and-forget Redis write (don't block the response)
      redis.set(REDIS_KEY(tier), fresh, { ex: TTL_SECONDS }).catch(() => undefined)
      return fresh
    } catch {
      // DB error — should not happen but don't crash
      return []
    }
  }

  // No Redis configured — use Next.js unstable_cache
  return tier === 'b2b' ? _b2bCached() : _retailCached()
}

// ── Cache invalidation ────────────────────────────────────────────────────────

/**
 * Invalidate the product cache for both tiers.
 * Call this after a QNE price sync so clients immediately see updated prices.
 * No-op when Redis is not configured (unstable_cache revalidates on next TTL).
 */
export async function invalidateProductsCache(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await Promise.all([
    redis.del(REDIS_KEY('retail')).catch(() => undefined),
    redis.del(REDIS_KEY('b2b')).catch(() => undefined),
  ])
}
