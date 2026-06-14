/**
 * GET /api/orders/[id]/delivery-quote
 * Returns a Lalamove price quote + smart booking time + surge flag for admin review.
 * Does NOT place any order — purely a preview step.
 */
import { verifySession }          from '@/lib/session'
import { isPrivilegedRole }        from '@/lib/authorization'
import { prisma }                  from '@/lib/prisma'
import { getCheapestLalamoveQuote, isLalamoveConfigured } from '@/lib/lalamoveClient'
import { getSmartBookingTime, checkSurge }                from '@/lib/lalamoveBooking'

const PICKUP_LAT     = process.env.LALAMOVE_PICKUP_LAT           ?? ''
const PICKUP_LNG     = process.env.LALAMOVE_PICKUP_LNG           ?? ''
const PICKUP_ADDRESS = process.env.LALAMOVE_PICKUP_ADDRESS        ?? 'Flexxo Warehouse'
const PICKUP_NAME    = process.env.LALAMOVE_PICKUP_CONTACT_NAME   ?? 'Flexxo Logistics'
const PICKUP_PHONE   = process.env.LALAMOVE_PICKUP_CONTACT_PHONE  ?? ''

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('60')) return `+${digits}`
  if (digits.startsWith('0'))  return `+6${digits}`
  return `+60${digits}`
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session)                        return Response.json({ error: 'Unauthorized' },  { status: 401 })
  if (!isPrivilegedRole(session.role)) return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  if (!isLalamoveConfigured()) {
    return Response.json({ error: 'Lalamove not configured (missing API credentials)' }, { status: 503 })
  }

  const { id } = await params

  const order = await prisma.order.findUnique({
    where:   { id },
    include: {
      company: {
        include: {
          addresses: { where: { isActive: true, isDefault: true } },
          contacts:  { where: { isActive: true }, orderBy: { isDecisionMaker: 'desc' }, take: 1 },
        },
      },
    },
  })

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'Packed') return Response.json({ error: 'Order must be in Packed status to get a delivery quote' }, { status: 422 })

  const addr = order.company.addresses.find(a => a.lat && a.lng)
  if (!addr?.lat || !addr?.lng) {
    return Response.json({
      error: 'No delivery address with coordinates. Go to the company page → Addresses and add lat/lng.',
    }, { status: 422 })
  }

  const contact        = order.company.contacts[0]
  const recipientName  = contact?.name  ?? order.company.name
  const recipientPhone = contact?.phone ?? ''
  if (!recipientPhone) {
    return Response.json({
      error: 'No phone number on primary contact. Add a mobile number to the contact first.',
    }, { status: 422 })
  }

  const bookingTime = getSmartBookingTime()

  let quote
  try {
    quote = await getCheapestLalamoveQuote({
      pickup:     { lat: PICKUP_LAT, lng: PICKUP_LNG, address: PICKUP_ADDRESS },
      dropoff:    { lat: addr.lat,   lng: addr.lng,   address: [addr.line1, addr.city, addr.postcode].filter(Boolean).join(', ') },
      sender:     { name: PICKUP_NAME,    phone: PICKUP_PHONE },
      recipient:  { name: recipientName,  phone: normalisePhone(recipientPhone) },
      scheduleAt: bookingTime.scheduleAt.toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Lalamove API error: ${msg}` }, { status: 502 })
  }

  if (!quote) {
    return Response.json({ error: 'No Lalamove service available for this route. Check pickup and dropoff coordinates.' }, { status: 422 })
  }

  const surge = checkSurge(quote.serviceType, quote.priceMyr)

  return Response.json({
    quoteId:     quote.quoteId,
    serviceType: quote.serviceType,
    priceMyr:    quote.priceMyr,
    expiresAt:   quote.expiresAt,
    bookingTime: {
      scheduleAt:  bookingTime.scheduleAt.toISOString(),
      isScheduled: bookingTime.isScheduled,
      label:       bookingTime.label,
    },
    surge,
    dropoff: {
      name:    recipientName,
      phone:   normalisePhone(recipientPhone),
      address: [addr.line1, addr.city, addr.postcode].filter(Boolean).join(', '),
    },
  })
}
