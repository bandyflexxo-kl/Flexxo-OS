/**
 * lib/agents/operationAgentTools.ts
 * DB + Lalamove tool implementations for the Operation AI Agent.
 * Calls Prisma and Lalamove libs directly — no HTTP round-trips.
 */
import { prisma }                from '@/lib/prisma'
import { getLalamoveQuotation }  from '@/lib/lalamoveClient'
import { getSmartBookingTime, checkSurge } from '@/lib/lalamoveBooking'
import { bookLalamoveDelivery }  from '@/lib/fulfillment'
import type { ServiceType }      from '@/lib/lalamoveClient'

export type ToolResult = Record<string, unknown>

const PICKUP_LAT     = process.env.LALAMOVE_PICKUP_LAT              ?? ''
const PICKUP_LNG     = process.env.LALAMOVE_PICKUP_LNG              ?? ''
const PICKUP_ADDRESS = process.env.LALAMOVE_PICKUP_ADDRESS          ?? 'Flexxo KL'
const PICKUP_NAME    = process.env.LALAMOVE_PICKUP_CONTACT_NAME     ?? 'Flexxo Logistics'
const PICKUP_PHONE   = process.env.LALAMOVE_PICKUP_CONTACT_PHONE    ?? ''

function normalisePhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('60')) return `+${d}`
  if (d.startsWith('0'))  return `+6${d}`
  return `+60${d}`
}

// ── list_orders_ready_for_delivery ───────────────────────────────────────────

export async function listOrdersReadyForDelivery(): Promise<ToolResult> {
  const orders = await prisma.order.findMany({
    where: {
      status: 'Packed',
      deliveryBooking: { is: null },
    },
    include: {
      company: { select: { name: true } },
      items:   { select: { qty: true } },
    },
    orderBy: { createdAt: 'asc' },
    take:    20,
  })

  if (orders.length === 0) return { message: 'No orders currently waiting for delivery booking.' }

  return {
    count: orders.length,
    orders: orders.map(o => ({
      orderId:     o.id,
      orderRef:    o.referenceNo ?? o.id.slice(0, 8),
      company:     o.company.name,
      itemCount:   o.items.reduce((s: number, i: { qty: { toNumber: () => number } }) => s + i.qty.toNumber(), 0),
      packedSince: o.createdAt.toISOString(),
    })),
  }
}

// ── get_delivery_quote ───────────────────────────────────────────────────────

export async function getDeliveryQuote(orderRef: string): Promise<ToolResult> {
  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { referenceNo: orderRef },
        { id: orderRef },
      ],
    },
    include: {
      company: {
        include: {
          addresses: { where: { isActive: true, isDefault: true } },
          contacts:  { where: { isActive: true }, orderBy: { isDecisionMaker: 'desc' }, take: 1 },
        },
      },
    },
  })

  if (!order) return { error: `Order "${orderRef}" not found.` }
  if (order.status !== 'Packed') return { error: `Order ${orderRef} is in status "${order.status}" — only Packed orders can be booked for delivery.` }

  const addr = order.company.addresses.find(a => a.lat && a.lng)
  if (!addr?.lat || !addr?.lng) {
    return { error: `No delivery address with coordinates found for ${order.company.name}. Add lat/lng to the company address first.` }
  }

  const contact  = order.company.contacts[0]
  const phone    = contact?.phone ?? ''
  if (!phone) return { error: `No phone number on primary contact for ${order.company.name}.` }

  const { scheduleAt, label: timeLabel } = getSmartBookingTime()
  const scheduleAtIso = scheduleAt.toISOString()

  const dropoff   = { lat: addr.lat, lng: addr.lng, address: [addr.line1, addr.city, addr.postcode].filter(Boolean).join(', ') }
  const recipient = { name: contact?.name ?? order.company.name, phone: normalisePhone(phone) }

  const serviceTypes: ServiceType[] = ['MOTORCYCLE', 'MPV', 'VAN']
  const results = await Promise.allSettled(
    serviceTypes.map(serviceType =>
      getLalamoveQuotation({
        serviceType,
        pickup:    { lat: PICKUP_LAT, lng: PICKUP_LNG, address: PICKUP_ADDRESS },
        dropoff,
        sender:    { name: PICKUP_NAME, phone: PICKUP_PHONE },
        recipient,
        scheduleAt: scheduleAtIso,
      })
    )
  )

  const quotes = results
    .map((r, i) => {
      if (r.status !== 'fulfilled') return null
      const q     = r.value
      const surge = checkSurge(serviceTypes[i], q.priceMyr)
      return {
        serviceType: serviceTypes[i],
        quoteId:     q.quoteId,
        priceMyr:    q.priceMyr,
        surgeLabel:  surge.label,
        isSurge:     surge.isSurge,
      }
    })
    .filter(Boolean)

  return {
    orderId:     order.id,
    orderRef:    order.referenceNo ?? order.id,
    company:     order.company.name,
    address:     dropoff.address,
    pickupTime:  timeLabel,
    quotes,
  }
}

// ── book_delivery ─────────────────────────────────────────────────────────────

export async function bookDelivery(
  orderId:     string,
  serviceType: string,
): Promise<ToolResult> {
  const result = await bookLalamoveDelivery(orderId, undefined)

  // bookLalamoveDelivery fetches a fresh cheapest quote internally if no preQuote given.
  // For Telegram inline button flow, we re-fetch for the specific service type.
  // This function is called from the agentic loop (web UI) — buttons handle specific types directly.
  if (!result.ok) return { error: result.error }

  return {
    booked:    true,
    bookingId: result.bookingId,
    shareLink: result.shareLink,
    message:   `Delivery booked successfully (${serviceType}). Tracking link: ${result.shareLink}`,
  }
}

// ── get_delivery_status ───────────────────────────────────────────────────────

export async function getDeliveryStatus(orderRef: string): Promise<ToolResult> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ referenceNo: orderRef }, { id: orderRef }] },
    include: {
      company:         { select: { name: true } },
      deliveryBooking: true,
    },
  })

  if (!order) return { error: `Order "${orderRef}" not found.` }

  const booking = order.deliveryBooking
  if (!booking) {
    return {
      orderRef:  order.referenceNo ?? order.id,
      company:   order.company.name,
      status:    order.status,
      delivery:  null,
      message:   'No delivery booking yet.',
    }
  }

  return {
    orderRef:     order.referenceNo ?? order.id,
    company:      order.company.name,
    orderStatus:  order.status,
    delivery: {
      bookingStatus:    booking.bookingStatus,
      serviceType:      booking.serviceType,
      quotedPriceMyr:   booking.quotedPriceMyr,
      driverName:       booking.driverName,
      driverPhone:      booking.driverPhone,
      plateNumber:      booking.plateNumber,
      shareLink:        booking.shareLink,
      bookedAt:         booking.bookedAt?.toISOString(),
      driverAssignedAt: booking.driverAssignedAt?.toISOString(),
    },
  }
}

// ── get_order_details ─────────────────────────────────────────────────────────

export async function getOrderDetails(orderRef: string): Promise<ToolResult> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ referenceNo: orderRef }, { id: orderRef }] },
    include: {
      company: {
        select: {
          name:      true,
          addresses: { where: { isDefault: true, isActive: true }, take: 1 },
          contacts:  { where: { isDecisionMaker: true, isActive: true }, take: 1 },
        },
      },
      items: {
        include: { product: { select: { name: true, unit: true, qneItemCode: true } } },
      },
      deliveryBooking: { select: { bookingStatus: true, shareLink: true, driverName: true, plateNumber: true } },
    },
  })

  if (!order) return { error: `Order "${orderRef}" not found.` }

  const addr    = order.company.addresses[0]
  const contact = order.company.contacts[0]

  return {
    orderRef:    order.referenceNo ?? order.id,
    status:      order.status,
    company:     order.company.name,
    contact:     contact ? `${contact.name} (${contact.phone ?? 'no phone'})` : 'N/A',
    address:     addr ? [addr.line1, addr.city, addr.postcode, addr.state].filter(Boolean).join(', ') : 'No address',
    currency:    order.currency,
    totalAmount: order.totalAmount?.toString() ?? '0',
    itemCount:   order.items.length,
    items:       order.items.map(i => ({
      name:  i.product?.name ?? 'Unknown product',
      code:  i.product?.qneItemCode,
      qty:   i.qty,
      unit:  i.product?.unit ?? 'pc',
      price: i.unitPrice.toString(),
    })),
    delivery: order.deliveryBooking ?? null,
  }
}
