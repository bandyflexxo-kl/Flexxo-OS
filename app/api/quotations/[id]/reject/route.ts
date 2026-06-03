import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().min(1, 'Reason for rejection is required.'),
})

/** Manager / Admin rejects a pending_review quotation, returning it to draft. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Only Managers and Admins can reject quotations.' }, { status: 403 })
  }

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  if (quotation.status !== 'pending_review') {
    return Response.json(
      { error: `Only pending_review quotations can be rejected. Current status: ${quotation.status}` },
      { status: 400 },
    )
  }

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'draft' },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'pending_review',
        toStatus:    'draft',
        changedById: session.userId,
        notes:       `Rejected: ${parsed.data.notes}`,
      },
    })
  })

  return Response.json({ ok: true, status: 'draft' })
}
