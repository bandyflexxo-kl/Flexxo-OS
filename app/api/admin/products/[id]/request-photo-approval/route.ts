import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'

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

// DELETE — Director/Manager rejects a pending approval request (keeps photo as flagged)
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session || !['Director', 'Manager'].includes(session.role)) {
    return Response.json({ error: 'Director or Manager required' }, { status: 403 })
  }

  const { id } = await params

  await prisma.product.update({
    where: { id },
    data:  { photoApprovalPending: false },
  })

  return Response.json({ rejected: true })
}
