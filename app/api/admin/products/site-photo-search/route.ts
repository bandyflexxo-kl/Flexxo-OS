/**
 * Accurate bulk searching — /admin/products?tab=bulk-search
 * GET  ?search=…&needsPhotoOnly=1 → products to pick from (for the multi-select).
 * POST { productId, website } → find that product's photo STRICTLY on `website`,
 *      download → Supabase → pending review + brand-aware AI scan. The client
 *      loops the selected products so the batch shows live progress.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { searchProductPhotoOnSite, normalizeDomain } from '@/lib/sitePhotoSearch'
import type { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'

export const maxDuration = 60

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const url            = new URL(request.url)
  const search         = url.searchParams.get('search')?.trim() ?? ''
  const needsPhotoOnly = url.searchParams.get('needsPhotoOnly') === '1'

  const where: Prisma.ProductWhereInput = { isActive: true }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { qneItemCode: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (needsPhotoOnly) {
    where.AND = [{ OR: [{ photoUrl: null, googleDrivePhotoId: null }, { photoQualityFlagged: true }] }]
  }

  const rows = await prisma.product.findMany({
    where,
    orderBy: [{ photoQualityFlagged: 'desc' }, { name: 'asc' }],
    take:    60,
    select:  {
      id: true, name: true, brand: true, qneItemCode: true,
      photoUrl: true, googleDrivePhotoId: true, photoQualityFlagged: true, photoApprovalPending: true,
    },
  })

  const products = rows.map(p => ({
    id:      p.id,
    name:    p.name,
    brand:   p.brand,
    code:    p.qneItemCode,
    status:  p.photoQualityFlagged ? 'flagged' as const
           : (!p.photoUrl && !p.googleDrivePhotoId) ? 'no-photo' as const
           : 'has-photo' as const,
    pending: p.photoApprovalPending,
  }))

  return Response.json({ products, truncated: rows.length === 60 })
}

const Body = z.object({
  productId: z.string().uuid(),
  website:   z.string().trim().min(3).max(200),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (!process.env.SERPER_API_KEY) {
    return Response.json({ error: 'Image search is not configured on the server (SERPER_API_KEY missing).' }, { status: 500 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  if (!normalizeDomain(parsed.data.website)) return Response.json({ error: 'Invalid website' }, { status: 400 })

  try {
    const result = await searchProductPhotoOnSite(parsed.data.productId, parsed.data.website)
    if (result.photoUrl) {
      const redis = getRedis()
      if (redis) await Promise.allSettled([redis.del('flexxo:products:v1:retail'), redis.del('flexxo:products:v1:b2b')])
    }
    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 500 })
  }
}
