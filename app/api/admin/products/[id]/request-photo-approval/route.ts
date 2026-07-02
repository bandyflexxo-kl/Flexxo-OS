import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { invalidateProductsCache } from '@/lib/products-api'

// POST — Admin requests Director approval for a photo override
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director', 'Manager'].includes(session.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const product = await prisma.product.findUnique({
    where:  { id },
    select: { id: true, photoUrl: true },
  })

  if (!product?.photoUrl) {
    return Response.json({ error: 'No photo to approve' }, { status: 400 })
  }

  await prisma.product.update({
    where: { id },
    data:  { photoApprovalPending: true },
  })

  return Response.json({ pending: true })
}

// DELETE — reviewer rejects a pending photo. It must be REMOVED, not just
// un-pended: the shop serves any photoUrl regardless of the quality flag, so a
// rejected-but-kept photo (especially one the AI scanned "clean") would show to
// customers — and merely clearing `photoApprovalPending` dropped it into the
// "Clean" bucket (the reported bug). Removing the photo returns the product to
// "no photo" so it can be re-searched or uploaded again.
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Admin', 'Director', 'Manager'].includes(session.role)) {
    return Response.json({ error: 'Admin, Director or Manager required' }, { status: 403 })
  }

  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id }, select: { photoUrl: true } })

  // Best-effort delete of the stored file from Supabase (DB clear is source of truth).
  const marker = '/storage/v1/object/public/product-photos/'
  if (product?.photoUrl?.includes(marker)) {
    try {
      const urlObj   = new URL(product.photoUrl)
      const filename = urlObj.pathname.split(marker)[1]
      if (filename) {
        const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/[^\x20-\x7E]/g, '')
        await fetch(`${urlObj.protocol}//${urlObj.host}/storage/v1/object/product-photos/${filename}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey}` } })
      }
    } catch { /* file may already be gone — DB clear below is what matters */ }
  }

  await prisma.product.update({
    where: { id },
    data:  {
      photoUrl:             null,
      photoApprovalPending: false,
      photoApprovedByAdmin: false,
      photoQualityFlagged:  null,
      photoQualityNote:     null,
    },
  })

  await invalidateProductsCache()
  return Response.json({ rejected: true, removed: true })
}
