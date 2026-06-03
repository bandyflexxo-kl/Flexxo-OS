import { getOptionalSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'
import { sendPushToUser } from '@/lib/webpush'
import { z } from 'zod'

const Schema = z.object({
  action: z.enum(['accept', 'decline']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid action.' }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    include: {
      items: {
        select: {
          id: true, productId: true,
          qty: true, unitPrice: true, lineTotal: true,
        },
      },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = assertPortalCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  if (quotation.status !== 'sent') {
    return Response.json({ error: 'This quotation cannot be responded to in its current status.' }, { status: 409 })
  }

  const newStatus = parsed.data.action === 'accept' ? 'accepted' : 'declined'

  await prisma.$transaction(async tx => {
    await tx.quotation.update({ where: { id }, data: { status: newStatus } })

    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'sent',
        toStatus:    newStatus,
        changedById: session.userId,
        notes:       `Customer ${parsed.data.action}d via portal`,
      },
    })

    // Auto-create an Order when the customer accepts
    if (parsed.data.action === 'accept') {
      const year     = new Date().getFullYear()
      const count    = await tx.order.count()
      const orderRef = `ORD-${year}-${String(count + 1).padStart(4, '0')}`

      const order = await tx.order.create({
        data: {
          companyId:   quotation.companyId,
          quotationId: quotation.id,
          referenceNo: orderRef,
          source:      'Quotation',
          status:      'Confirmed',
          currency:    quotation.currency,
          totalAmount: quotation.totalAmount,
          createdById: session.userId,
        },
      })

      // Copy quotation items to order items
      if (quotation.items.length > 0) {
        await tx.orderItem.createMany({
          data: quotation.items.map(item => ({
            orderId:        order.id,
            productId:      item.productId,
            quotationItemId: item.id,
            qty:            item.qty,
            unitPrice:      item.unitPrice,
            lineTotal:      item.lineTotal,
          })),
        })
      }
    }
  })

  // Push: notify the salesperson who created the quote (fire-and-forget)
  if (quotation.createdById) {
    const isAccepted = parsed.data.action === 'accept'
    sendPushToUser(quotation.createdById, {
      title: isAccepted ? '🎉 Quote Accepted!' : '❌ Quote Declined',
      body:  isAccepted
        ? `${quotation.referenceNo ?? 'Your quotation'} was accepted by the client — an order has been created.`
        : `${quotation.referenceNo ?? 'Your quotation'} was declined by the client.`,
      url: `/quotations/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: newStatus })
}
