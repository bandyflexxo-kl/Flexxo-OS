import { prisma }                  from '@/lib/prisma'
import { getLalamoveOrderStatus }  from '@/lib/lalamoveClient'
import { sendWabaTemplate }        from '@/lib/wabaClient'
import { sendGoogleReviewRequest } from '@/lib/fulfillment'

export async function GET(request: Request) {
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find active bookings that haven't been assigned a driver yet
  const bookings = await prisma.deliveryBooking.findMany({
    where: {
      bookingStatus:   'booked',
      lalamoveOrderRef: { not: null },
    },
    include: {
      order: {
        include: {
          company: {
            include: {
              contacts: {
                where: { isActive: true },
                orderBy: { isDecisionMaker: 'desc' },
                take: 1,
              },
            },
          },
        },
      },
    },
  })

  let driverAssigned = 0
  let delivered      = 0

  for (const booking of bookings) {
    if (!booking.lalamoveOrderRef) continue

    try {
      const status = await getLalamoveOrderStatus(booking.lalamoveOrderRef)

      if (status.status === 'COMPLETED') {
        // Auto-mark delivered
        await prisma.$transaction(async tx => {
          await tx.order.update({
            where: { id: booking.orderId },
            data:  { status: 'Delivered', deliveredAt: new Date() },
          })
          await tx.deliveryBooking.update({
            where: { id: booking.id },
            data:  { bookingStatus: 'completed' },
          })
          await tx.activity.create({
            data: {
              companyId:    booking.order.companyId,
              activityType: 'order_status_change',
              subject:      `Order ${booking.order.referenceNo ?? booking.orderId} delivered (Lalamove)`,
              body:         'Auto-detected via Lalamove status poll',
              userId:       booking.order.createdById,
            },
          })
        })
        sendGoogleReviewRequest(booking.orderId).catch(() => undefined)
        delivered++
        continue
      }

      // Driver assigned for first time
      if (status.driver && !booking.driverAssignedAt) {
        await prisma.deliveryBooking.update({
          where: { id: booking.id },
          data: {
            driverName:       status.driver.driverName,
            driverPhone:      status.driver.driverPhone,
            plateNumber:      status.driver.plateNumber,
            bookingStatus:    'driver_assigned',
            driverAssignedAt: new Date(),
          },
        })

        // Notify client
        const contact = booking.order.company.contacts[0]
        const phone   = contact?.whatsapp
        const name    = contact?.name ?? booking.order.company.name

        if (phone) {
          sendWabaTemplate(phone, 'order_update', [
            { type: 'body', parameters: [
              { type: 'text', text: name },
              { type: 'text', text: booking.order.referenceNo ?? booking.orderId },
              { type: 'text', text: `Out for delivery — ${status.driver.driverName} (${status.driver.plateNumber})` },
            ]},
          ]).catch(() => undefined)
        }

        driverAssigned++
      }
    } catch {
      // Silently skip failed status checks — don't break the whole poll
    }
  }

  return Response.json({ ok: true, polled: bookings.length, driverAssigned, delivered })
}
