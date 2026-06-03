import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await getOptionalSession()
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

  return Response.json({ quotationId: quotation.id, referenceNo: refNo })
}
