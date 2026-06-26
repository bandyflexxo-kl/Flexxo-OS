import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  // Only Director or Manager can permanently approve — Admin must use request-photo-approval
  if (!session || !['Director', 'Manager'].includes(session.role)) {
    return Response.json({ error: 'Director or Manager approval required', requiresApproval: true }, { status: 403 })
  }

  const { id } = await params

  await prisma.product.update({
    where: { id },
    data:  {
      photoQualityFlagged:  false,
      photoQualityNote:     `Permanently approved by ${session.name ?? 'Director'} — AI scan skipped`,
      photoApprovedByAdmin: true,
      photoApprovalPending: false,
    },
  })

  return Response.json({ approved: true })
}
