import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { scanPhotoUrl } from '@/lib/photoQuality'

const MAX_BATCH = 10

type BatchResult = {
  id:      string
  name:    string
  flagged: boolean
  reason:  string
  error?:  string
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as { ids?: string[] }
  const ids  = (body.ids ?? []).slice(0, MAX_BATCH)
  if (ids.length === 0) return Response.json({ results: [] })

  const products = await prisma.product.findMany({
    where:  { id: { in: ids }, photoUrl: { not: null }, photoApprovedByAdmin: false },
    select: { id: true, name: true, photoUrl: true },
  })

  const results: BatchResult[] = await Promise.all(
    products.map(async (p): Promise<BatchResult> => {
      try {
        const { flagged, reason } = await scanPhotoUrl(p.id, p.photoUrl!)
        return { id: p.id, name: p.name, flagged, reason }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        // Mark as scan-error so we don't retry infinitely
        await prisma.product.update({
          where: { id: p.id },
          data:  { photoQualityFlagged: false, photoQualityNote: `Scan error: ${msg.slice(0, 80)}` },
        }).catch(() => null)
        return { id: p.id, name: p.name, flagged: false, reason: '', error: msg }
      }
    })
  )

  return Response.json({ results })
}
