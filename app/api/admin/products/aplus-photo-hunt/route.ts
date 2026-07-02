/**
 * APLUS photo hunt — /admin/products?tab=aplus-photos
 * GET  → list the target set (unmatched/flagged APLUS products) + counts.
 * POST → { productId } hunt one product (search STP-first, download, upload,
 *         AI quality scan). The client loops over the target ids so the batch
 *         shows live progress and no single request runs long. Nothing goes live:
 *         found photos land in the Photo Review "pending" queue.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { huntAplusPhotoForProduct, aplusTargetWhere, aplusCode } from '@/lib/aplusPhotoHunt'
import { z } from 'zod'

export const maxDuration = 60

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.product.findMany({
    where:   aplusTargetWhere,
    orderBy: { name: 'asc' },
    select:  {
      id: true, name: true, qneItemCode: true, internalSku: true,
      photoUrl: true, photoQualityFlagged: true, photoApprovalPending: true,
    },
  })

  const targets = rows.map(p => ({
    id:      p.id,
    name:    p.name,
    code:    aplusCode(p.qneItemCode, p.internalSku),
    reason:  p.photoQualityFlagged ? 'flagged' as const : 'no-photo' as const,
    pending: p.photoApprovalPending,
  }))

  return Response.json({
    total:    targets.length,
    noPhoto:  targets.filter(t => t.reason === 'no-photo').length,
    flagged:  targets.filter(t => t.reason === 'flagged').length,
    targets,
  })
}

const Body = z.object({ productId: z.string().uuid() })

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  if (!process.env.SERPER_API_KEY) {
    return Response.json({ error: 'Image search is not configured on the server (SERPER_API_KEY missing).' }, { status: 500 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const result = await huntAplusPhotoForProduct(parsed.data.productId)
    // A newly-attached photo changes the shop catalogue only after approval, but
    // bust the product cache so the admin/photo views reflect the new photoUrl.
    if (result.photoUrl) {
      const redis = getRedis()
      if (redis) await Promise.allSettled([redis.del('flexxo:products:v1:retail'), redis.del('flexxo:products:v1:b2b')])
    }
    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Hunt failed' }, { status: 500 })
  }
}
