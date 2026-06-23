import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { isPrivilegedRole } from '@/lib/authorization'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: contactId, requestId } = await params

  const editReq = await prisma.contactEditRequest.findUnique({
    where:   { id: requestId },
    include: { contact: { select: { id: true, companyId: true, name: true } }, requestedBy: { select: { id: true, name: true } } },
  })

  if (!editReq || editReq.contactId !== contactId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (editReq.status !== 'pending') {
    return Response.json({ error: 'Request is no longer pending' }, { status: 409 })
  }

  const changes = editReq.changes as Record<string, unknown>

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  await prisma.$transaction(async tx => {
    // Apply the proposed changes to the contact
    await tx.contact.update({ where: { id: contactId }, data: changes })

    // Mark request as approved
    await tx.contactEditRequest.update({
      where: { id: requestId },
      data:  { status: 'approved', approvedById: session.userId, approvedAt: new Date() },
    })

    // Log activity on the company so both parties can see it
    const fieldList = Object.keys(changes).join(', ')
    await tx.activity.create({
      data: {
        companyId:    editReq.contact.companyId,
        userId:       session.userId,
        activityType: 'note',
        subject:      `Contact edit approved: ${editReq.contact.name}`,
        body:         `Edit request by ${editReq.requestedBy.name} approved.\nFields updated: ${fieldList}`,
      },
    })
  })

  return Response.json({ ok: true })
}
