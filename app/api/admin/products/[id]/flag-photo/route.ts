/**
 * POST /api/admin/products/[id]/flag-photo
 * Manually flag a product's photo as unacceptable — for clean OR locked photos
 * a reviewer realises are wrong (staff mis-clean, or the AI scan missed it).
 * Sets photoQualityFlagged=true, UNLOCKS it (photoApprovedByAdmin=false) so the
 * AI will scan it again, and clears any pending-approval state. Admin/Director only.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true } })
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  await prisma.product.update({
    where: { id },
    data: {
      photoQualityFlagged:  true,
      photoQualityNote:     `Manually flagged by ${session.name}`,
      photoApprovedByAdmin: false,   // unlock so it can be re-scanned/re-reviewed
      photoApprovalPending: false,
    },
  })

  return Response.json({ ok: true })
}
