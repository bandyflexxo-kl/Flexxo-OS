import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'

const BodySchema = z.object({ reason: z.string().max(500).optional() })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: contactId, requestId } = await params
  const body = await request.json().catch(() => ({})) as unknown
  const parsed = BodySchema.safeParse(body)
  const reason = parsed.success ? (parsed.data.reason ?? null) : null

  const editReq = await prisma.contactEditRequest.findUnique({
    where:   { id: requestId },
    include: { contact: { select: { id: true, companyId: true, name: true } }, requestedBy: { select: { name: true } } },
  })

  if (!editReq || editReq.contactId !== contactId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (editReq.status !== 'pending') {
    return Response.json({ error: 'Request is no longer pending' }, { status: 409 })
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  await prisma.$transaction(async tx => {
    await tx.contactEditRequest.update({
      where: { id: requestId },
      data:  { status: 'rejected', approvedById: session.userId, rejectedAt: new Date(), rejectionNote: reason },
    })

    await tx.activity.create({
      data: {
        companyId:    editReq.contact.companyId,
        userId:       session.userId,
        activityType: 'note',
        subject:      `Contact edit rejected: ${editReq.contact.name}`,
        body:         `Edit request by ${editReq.requestedBy.name} was rejected.${reason ? `\nReason: ${reason}` : ''}`,
      },
    })
  })

  return Response.json({ ok: true })
}
