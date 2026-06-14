/**
 * POST /api/webhooks/lalamove
 * Receives delivery status updates from Lalamove.
 * Signature: X-LLM-Signature: t=<epoch_ms>,v1=<hmac_sha256_hex>
 * Signing string: `${t}.${rawBody}`
 */
import crypto   from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendGoogleReviewRequest } from '@/lib/fulfillment'

const WEBHOOK_SECRET = process.env.LALAMOVE_WEBHOOK_SECRET ?? ''

function verifySignature(rawBody: string, sigHeader: string | null): boolean {
  if (!WEBHOOK_SECRET || !sigHeader) return false
  const parts: Record<string, string> = {}
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }
  const t   = parts['t']
  const v1  = parts['v1']
  if (!t || !v1) return false
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${rawBody}`)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
}

type LalamoveWebhookPayload = {
  orderId:    string
  status:     string
  driverInfo?: {
    name?:        string
    phone?:       string
    plateNumber?: string
  }
}

// Lalamove v3 order status → our booking status
const STATUS_MAP: Record<string, string> = {
  ASSIGNING_DRIVER: 'booked',
  ON_GOING:         'driver_assigned',
  PICKED_UP:        'in_transit',
  COMPLETED:        'completed',
  REJECTED:         'failed',
  EXPIRED:          'failed',
  CANCELED:         'failed',
}

export async function POST(request: Request) {
  const rawBody  = await request.text()
  const sigHeader = request.headers.get('X-LLM-Signature')

  if (!verifySignature(rawBody, sigHeader)) {
    console.warn('[lalamove-webhook] Invalid signature — rejected')
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: LalamoveWebhookPayload
  try {
    payload = JSON.parse(rawBody) as LalamoveWebhookPayload
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { orderId: lalamoveRef, status, driverInfo } = payload
  if (!lalamoveRef || !status) {
    return Response.json({ error: 'Missing orderId or status' }, { status: 400 })
  }

  const booking = await prisma.deliveryBooking.findFirst({
    where: { lalamoveOrderRef: lalamoveRef },
  })

  if (!booking) {
    // Not our order (could be a test event from Lalamove dashboard)
    return Response.json({ ok: true, note: 'Order not found — ignored' })
  }

  const newBookingStatus = STATUS_MAP[status] ?? booking.bookingStatus

  await prisma.$transaction(async tx => {
    await tx.deliveryBooking.update({
      where: { id: booking.id },
      data: {
        bookingStatus:   newBookingStatus,
        driverName:      driverInfo?.name        ?? booking.driverName,
        driverPhone:     driverInfo?.phone        ?? booking.driverPhone,
        plateNumber:     driverInfo?.plateNumber  ?? booking.plateNumber,
        ...(status === 'ON_GOING' ? { driverAssignedAt: new Date() } : {}),
      },
    })

    if (status === 'COMPLETED') {
      await tx.order.update({
        where: { id: booking.orderId },
        data:  { status: 'Delivered', deliveredAt: new Date() },
      })
    }

    if (status === 'REJECTED' || status === 'EXPIRED' || status === 'CANCELED') {
      // Reset order to Packed so admin can retry
      await tx.order.update({
        where: { id: booking.orderId },
        data:  { status: 'Packed' },
      })
    }
  })

  // Fire Google Review request after delivery (fire-and-forget)
  if (status === 'COMPLETED') {
    sendGoogleReviewRequest(booking.orderId).catch(() => undefined)
  }

  console.log(`[lalamove-webhook] ${lalamoveRef} → ${status} (booking ${booking.id})`)
  return Response.json({ ok: true })
}
