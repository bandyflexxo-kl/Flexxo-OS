import { prisma } from '@/lib/prisma'
import { notifyUser, notifyByRole, esc } from '@/lib/telegramBot'
import { sendPushToUser } from '@/lib/webpush'
import { sendOrderStatusWhatsApp } from '@/lib/wabaMessages'

const VERIFY_TOKEN = process.env.WABA_WEBHOOK_VERIFY_TOKEN ?? ''

// ── GET — Meta webhook verification ───────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

// ── POST — Incoming messages ───────────────────────────────────────────────────

type WabaEntry = {
  changes: Array<{
    value: {
      messages?: Array<{
        type:      string
        from:      string
        timestamp: string
        button?:   { payload: string; text: string }
      }>
    }
  }>
}

type WabaWebhookBody = {
  object: string
  entry:  WabaEntry[]
}

export async function POST(request: Request) {
  const body = await request.json() as WabaWebhookBody

  if (body.object !== 'whatsapp_business_account') {
    return Response.json({ ok: true })
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value.messages ?? []) {
        if (message.type === 'button' && message.button?.payload) {
          await handleButtonPayload(message.button.payload).catch(err =>
            console.error('[WABA webhook] Error handling button:', err)
          )
        }
      }
    }
  }

  return Response.json({ ok: true })
}

async function handleButtonPayload(payload: string) {
  // Payload format: "ACCEPT_{quotationId}" or "DECLINE_{quotationId}"
  const match = /^(ACCEPT|DECLINE)_(.+)$/.exec(payload)
  if (!match) return

  const [, actionRaw, quotationId] = match
  const action = actionRaw === 'ACCEPT' ? 'accept' : 'decline'

  const quotation = await prisma.quotation.findUnique({
    where:   { id: quotationId },
    include: {
      company: { select: { name: true } },
      items: {
        select: { id: true, productId: true, qty: true, unitPrice: true, lineTotal: true },
      },
    },
  })

  if (!quotation || quotation.status !== 'sent') return

  const newStatus = action === 'accept' ? 'accepted' : 'declined'

  const result = await prisma.$transaction(async tx => {
    await tx.quotation.update({ where: { id: quotationId }, data: { status: newStatus } })

    await tx.quotationStatusHistory.create({
      data: {
        quotationId,
        fromStatus:  'sent',
        toStatus:    newStatus,
        changedById: quotation.createdById ?? undefined,
        notes:       `Customer ${action}d via WhatsApp button reply`,
      },
    })

    if (action !== 'accept') return { newOrder: null as { id: string; referenceNo: string | null } | null }

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
        createdById: quotation.createdById ?? undefined,
      },
    })

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

    return { newOrder: { id: order.id, referenceNo: orderRef } }
  })

  const isAccepted  = action === 'accept'
  const companyName = quotation.company.name
  const qtRef       = quotation.referenceNo ?? 'quotation'
  const orderRef    = result.newOrder?.referenceNo ?? null
  const amtMyr      = quotation.totalAmount ? `MYR ${Number(quotation.totalAmount).toFixed(2)}` : ''

  if (quotation.createdById) {
    sendPushToUser(quotation.createdById, {
      title: isAccepted ? '🎉 Quote Accepted!' : '❌ Quote Declined',
      body:  isAccepted
        ? `${qtRef} accepted via WhatsApp by ${companyName} — order ${orderRef ?? ''} created.`
        : `${qtRef} declined via WhatsApp by ${companyName}.`,
      url: `/quotations/${quotationId}`,
    }).catch(() => undefined)
  }

  if (isAccepted && result.newOrder) {
    const ordId12 = result.newOrder.id.slice(0, 12)

    if (quotation.createdById) {
      notifyUser(
        quotation.createdById,
        `🎉 <b>${esc(companyName)}</b> accepted <b>${esc(qtRef)}</b> via WhatsApp!\n\n` +
        `Order <b>${esc(orderRef ?? '')}</b>${amtMyr ? ` (${esc(amtMyr)})` : ''} created.\n` +
        `Admin will approve shortly.`,
      ).catch(() => undefined)
    }

    notifyByRole(
      ['Admin', 'Director', 'Manager'],
      `🎉 <b>New Order — Action Required</b>\n\n` +
      `<b>${esc(companyName)}</b> accepted <b>${esc(qtRef)}</b> via WhatsApp\n` +
      `Order: <b>${esc(orderRef ?? '')}</b>${amtMyr ? ` · ${esc(amtMyr)}` : ''}\n\n` +
      `Tap <b>Approve</b> to issue invoice + create warehouse picking task.`,
      [[{ text: '✅ Approve Order', callback_data: `aord:${ordId12}` }]],
    ).catch(() => undefined)

    sendOrderStatusWhatsApp({
      companyId: quotation.companyId,
      orderId:   result.newOrder.id,
      orderRef:  orderRef ?? result.newOrder.id.slice(0, 8),
      newStatus: 'Confirmed',
      userId:    'system',
    }).catch(() => undefined)
  } else if (!isAccepted && quotation.createdById) {
    notifyUser(
      quotation.createdById,
      `❌ <b>${esc(companyName)}</b> declined <b>${esc(qtRef)}</b> via WhatsApp.`,
    ).catch(() => undefined)
  }
}
