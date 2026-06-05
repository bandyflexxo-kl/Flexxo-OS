import { prisma }                  from '@/lib/prisma'
import { bookLalamoveDelivery }    from '@/lib/fulfillment'
import { isLalamoveBookingWindow } from '@/lib/orderStatus'

export async function GET(request: Request) {
  // Verify cron secret
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Belt-and-suspenders: verify we're in a booking window (cron fires at window start)
  if (!isLalamoveBookingWindow()) {
    return Response.json({ ok: true, skipped: true, reason: 'Outside booking window' })
  }

  // Find all Packed orders with no booking or failed booking (retryCount < 3)
  const orders = await prisma.order.findMany({
    where: {
      status: 'Packed',
      OR: [
        { deliveryBooking: null },
        { deliveryBooking: { bookingStatus: 'failed', retryCount: { lt: 3 } } },
      ],
    },
    select: { id: true, referenceNo: true },
  })

  let booked = 0
  let failed = 0
  const results: { ref: string; ok: boolean; error?: string }[] = []

  for (const order of orders) {
    const result = await bookLalamoveDelivery(order.id)
    if (result.ok) {
      booked++
      results.push({ ref: order.referenceNo ?? order.id, ok: true })
    } else {
      failed++
      results.push({ ref: order.referenceNo ?? order.id, ok: false, error: result.error })

      // Increment retry count and set next retry time
      await prisma.deliveryBooking.upsert({
        where:  { orderId: order.id },
        create: {
          orderId:       order.id,
          bookingStatus: 'failed',
          retryCount:    1,
          nextRetryAt:   nextBookingWindow(),
        },
        update: {
          bookingStatus: 'failed',
          retryCount:    { increment: 1 },
          nextRetryAt:   nextBookingWindow(),
        },
      })

      // After 3 failures: alert Admin/Manager (push notification)
      const booking = await prisma.deliveryBooking.findUnique({
        where: { orderId: order.id },
        select: { retryCount: true },
      })
      if ((booking?.retryCount ?? 0) >= 3) {
        const managers = await prisma.userRole.findMany({
          where:   { role: { name: { in: ['Admin', 'Manager'] } }, revokedAt: null },
          include: { user: { select: { id: true } } },
        })
        const { sendPushToUser } = await import('@/lib/webpush')
        for (const m of managers) {
          sendPushToUser(m.user.id, {
            title: '⚠️ Delivery Booking Failed',
            body:  `${order.referenceNo ?? order.id} — 3 attempts failed. Manual booking needed.`,
            url:   `/orders/${order.id}`,
          }).catch(() => undefined)
        }
      }
    }
  }

  return Response.json({ ok: true, booked, failed, results })
}

// Return the start of the next booking window (KL time, UTC+8)
function nextBookingWindow(): Date {
  const now     = new Date()
  const klNow   = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const h       = klNow.getUTCHours()
  const m       = klNow.getUTCMinutes()
  const total   = h * 60 + m

  let nextKL: Date
  if (total < 10 * 60) {
    // Before 10:00 — next window is today 10:00
    nextKL = new Date(klNow)
    nextKL.setUTCHours(10, 0, 0, 0)
  } else if (total < 13 * 60 + 45) {
    // Before 13:45 — next window is today 13:45
    nextKL = new Date(klNow)
    nextKL.setUTCHours(13, 45, 0, 0)
  } else {
    // After 13:45 — next window is tomorrow 10:00
    nextKL = new Date(klNow)
    nextKL.setUTCDate(nextKL.getUTCDate() + 1)
    nextKL.setUTCHours(10, 0, 0, 0)
  }

  // Convert back to UTC
  return new Date(nextKL.getTime() - 8 * 60 * 60 * 1000)
}
