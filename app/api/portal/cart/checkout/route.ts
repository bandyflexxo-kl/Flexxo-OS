import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/webpush'

export async function POST() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ error: 'No company linked to this account.' }, { status: 400 })
  }

  const cart = await prisma.quotation.findFirst({
    where: { status: 'cart', createdById: session.userId },
    include: { items: { select: { id: true } } },
  })

  if (!cart) return Response.json({ error: 'No active cart found.' }, { status: 400 })
  if (cart.items.length === 0) return Response.json({ error: 'Your cart is empty.' }, { status: 400 })

  // Generate permanent reference number: QT-YYYY-NNNN
  const year     = new Date().getFullYear()
  const count    = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  const refNo    = `QT-${year}-${String(count + 1).padStart(4, '0')}`

  const quotation = await prisma.$transaction(async tx => {
    const updated = await tx.quotation.update({
      where: { id: cart.id },
      data:  { status: 'pending_review', referenceNo: refNo },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: cart.id,
        fromStatus:  'cart',
        toStatus:    'pending_review',
        changedById: session.userId,
        notes:       'Submitted by customer via portal',
      },
    })
    return updated
  })

  // Push: notify the salesperson assigned to this company (fire-and-forget)
  const assignment = await prisma.companyAssignment.findFirst({
    where:   { companyId: session.customerCompanyId, unassignedAt: null },
    select:  { userId: true },
    orderBy: { assignedAt: 'desc' },
  })
  if (assignment) {
    sendPushToUser(assignment.userId, {
      title: '🛒 New Quote Request',
      body:  `${refNo} — a client just submitted a new quote request from the portal.`,
      url:   `/quotations/${quotation.id}`,
    }).catch(() => undefined)
  }

  return Response.json({ quotationId: quotation.id, referenceNo: refNo })
}
