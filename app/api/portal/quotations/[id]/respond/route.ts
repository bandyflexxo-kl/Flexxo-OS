import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'
import { sendPushToUser } from '@/lib/webpush'
import { notifyUser, notifyByRole, esc } from '@/lib/telegramBot'
import { sendOrderStatusWhatsApp } from '@/lib/wabaMessages'
import { z } from 'zod'

const Schema = z.object({
  action: z.enum(['accept', 'decline']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
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
      company: { select: { name: true } },
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

  const { newOrder } = await prisma.$transaction(async tx => {
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
            orderId:         order.id,
            productId:       item.productId,
            quotationItemId: item.id,
            qty:             item.qty,
            unitPrice:       item.unitPrice,
            lineTotal:       item.lineTotal,
          })),
        })
      }

      return { newOrder: { id: order.id, referenceNo: order.referenceNo as string | null } }
    }

    return { newOrder: null as { id: string; referenceNo: string | null } | null }
  })

  const isAccepted = parsed.data.action === 'accept'
  const companyName = quotation.company.name
  const qtRef       = quotation.referenceNo ?? 'quotation'
  const orderRef    = newOrder?.referenceNo ?? null
  const amtMyr      = quotation.totalAmount ? `MYR ${Number(quotation.totalAmount).toFixed(2)}` : ''

  // Push: notify the salesperson who created the quote (fire-and-forget)
  if (quotation.createdById) {
    sendPushToUser(quotation.createdById, {
      title: isAccepted ? '🎉 Quote Accepted!' : '❌ Quote Declined',
      body:  isAccepted
        ? `${qtRef} was accepted by ${companyName} — order ${orderRef ?? ''} created.`
        : `${qtRef} was declined by ${companyName}.`,
      url: `/quotations/${id}`,
    }).catch(() => undefined)
  }

  if (isAccepted && newOrder) {
    const ordId12 = newOrder.id.slice(0, 12)

    // Telegram → salesperson: simple confirmation
    if (quotation.createdById) {
      notifyUser(
        quotation.createdById,
        `🎉 <b>${esc(companyName)}</b> accepted <b>${esc(qtRef)}</b>!\n\n` +
        `Order <b>${esc(orderRef ?? '')} </b>${amtMyr ? `(${esc(amtMyr)})` : ''} has been created.\n` +
        `Admin will approve it shortly.`,
      ).catch(() => undefined)
    }

    // Telegram → Admin/Director: with [Approve Order] inline button
    notifyByRole(
      ['Admin', 'Director', 'Manager'],
      `🎉 <b>New Order — Action Required</b>\n\n` +
      `<b>${esc(companyName)}</b> accepted <b>${esc(qtRef)}</b>\n` +
      `Order: <b>${esc(orderRef ?? '')}</b>${amtMyr ? ` · ${esc(amtMyr)}` : ''}\n\n` +
      `Tap <b>Approve</b> to issue invoice + create warehouse picking task.`,
      [[
        { text: '✅ Approve Order', callback_data: `aord:${ordId12}` },
      ]],
    ).catch(() => undefined)

    // WABA → customer: order confirmed
    sendOrderStatusWhatsApp({
      companyId: quotation.companyId,
      orderId:   newOrder.id,
      orderRef:  orderRef ?? newOrder.id.slice(0, 8),
      newStatus: 'Confirmed',
      userId:    'system',
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: newStatus })
}
