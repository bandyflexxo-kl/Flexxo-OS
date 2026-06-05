/**
 * lib/fulfillment.ts
 * Shared order fulfilment logic — called by both route handlers and cron jobs.
 */
import { prisma }                     from '@/lib/prisma'
import { getCheapestLalamoveQuote, placeLalamoveOrder, isLalamoveConfigured } from '@/lib/lalamoveClient'
import { sendWabaTemplate }           from '@/lib/wabaClient'
import { sendGenericEmail }           from '@/lib/email'
import { sendPushToUser }             from '@/lib/webpush'

const PICKUP_LAT     = process.env.LALAMOVE_PICKUP_LAT              ?? ''
const PICKUP_LNG     = process.env.LALAMOVE_PICKUP_LNG              ?? ''
const PICKUP_ADDRESS = process.env.LALAMOVE_PICKUP_ADDRESS          ?? 'Flexxo KL Sdn Bhd'
const PICKUP_NAME    = process.env.LALAMOVE_PICKUP_CONTACT_NAME     ?? 'Flexxo Logistics'
const PICKUP_PHONE   = process.env.LALAMOVE_PICKUP_CONTACT_PHONE    ?? ''
const GOOGLE_REVIEW  = process.env.GOOGLE_REVIEW_URL               ?? ''
const APP_URL        = process.env.NEXTAUTH_URL                     ?? 'https://flexxo-sales-os.vercel.app'

export type BookResult =
  | { ok: true;  bookingId: string; shareLink: string }
  | { ok: false; error: string }

// ── Book Lalamove delivery for a single order ─────────────────────────────────
export async function bookLalamoveDelivery(orderId: string): Promise<BookResult> {
  if (!isLalamoveConfigured()) {
    return { ok: false, error: 'Lalamove not configured (missing API key/secret)' }
  }

  // Load order + company + default delivery address
  const order = await prisma.order.findUnique({
    where:   { id: orderId },
    include: {
      company: {
        include: {
          addresses: { where: { isActive: true, isDefault: true } },
          contacts:  {
            where:   { isActive: true },
            orderBy: { isDecisionMaker: 'desc' },
            take:    1,
          },
        },
      },
    },
  })

  if (!order) return { ok: false, error: 'Order not found' }
  if (order.status !== 'Packed') return { ok: false, error: 'Order is not in Packed status' }

  // Find delivery address with coordinates
  const addr = order.company.addresses.find(a => a.lat && a.lng)
  if (!addr?.lat || !addr?.lng) {
    return { ok: false, error: 'No delivery address with coordinates found. Add lat/lng to the company address.' }
  }

  // Recipient contact
  const contact  = order.company.contacts[0]
  const recipientName  = contact?.name  ?? order.company.name
  const recipientPhone = contact?.mobile ?? contact?.phone ?? ''

  if (!recipientPhone) {
    return { ok: false, error: 'No phone number on primary contact. Add a mobile number to the contact.' }
  }

  // Get cheapest quote
  const quote = await getCheapestLalamoveQuote({
    pickup:    { lat: PICKUP_LAT, lng: PICKUP_LNG, address: PICKUP_ADDRESS },
    dropoff:   { lat: addr.lat,   lng: addr.lng,   address: [addr.line1, addr.city, addr.postcode].filter(Boolean).join(', ') },
    sender:    { name: PICKUP_NAME, phone: PICKUP_PHONE },
    recipient: { name: recipientName, phone: normalisePhone(recipientPhone) },
  })

  if (!quote) {
    return { ok: false, error: 'Lalamove returned no quotes. Check coordinates and phone number.' }
  }

  // Place order
  const result = await placeLalamoveOrder({
    quoteId:   quote.quoteId,
    sender:    { name: PICKUP_NAME, phone: PICKUP_PHONE },
    recipient: { name: recipientName, phone: normalisePhone(recipientPhone) },
    remarks:   `Order ${order.referenceNo ?? orderId} — ${order.company.name}`,
  })

  // Save booking + update order status in a transaction
  await prisma.$transaction(async tx => {
    await tx.deliveryBooking.upsert({
      where:  { orderId },
      create: {
        orderId,
        lalamoveOrderRef: result.orderId,
        serviceType:      quote.serviceType,
        quotedPriceMyr:   quote.priceMyr,
        shareLink:        result.shareLink,
        bookingStatus:    'booked',
        bookedAt:         new Date(),
      },
      update: {
        lalamoveOrderRef: result.orderId,
        serviceType:      quote.serviceType,
        quotedPriceMyr:   quote.priceMyr,
        shareLink:        result.shareLink,
        bookingStatus:    'booked',
        bookedAt:         new Date(),
        retryCount:       0,
      },
    })

    await tx.order.update({
      where: { id: orderId },
      data:  { status: 'Delivering' },
    })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `${order.referenceNo ?? orderId}: Lalamove booked (${quote.serviceType}, MYR ${quote.priceMyr.toFixed(2)})`,
        body:         `Share link: ${result.shareLink}`,
        userId:       order.createdById,
      },
    })
  })

  // Send tracking notification to client (fire-and-forget)
  sendTrackingNotification(orderId, order.company.name, recipientPhone, result.shareLink, order.referenceNo ?? orderId).catch(() => undefined)

  return { ok: true, bookingId: result.orderId, shareLink: result.shareLink }
}

// ── Send tracking link to client ─────────────────────────────────────────────
export async function sendTrackingNotification(
  orderId:       string,
  companyName:   string,
  recipientPhone: string,
  shareLink:     string,
  orderRef:      string,
): Promise<void> {
  // Load contact for WABA
  const order = await prisma.order.findUnique({
    where:   { id: orderId },
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
  })
  if (!order) return

  const contact = order.company.contacts[0]
  const phone   = contact?.whatsapp ?? normalisePhone(recipientPhone)
  const name    = contact?.name ?? companyName

  // WABA WhatsApp (template: order_update)
  if (phone) {
    sendWabaTemplate(phone, 'order_update', [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: orderRef },
        { type: 'text', text: 'Out for delivery' },
      ]},
    ]).catch(() => undefined)
  }

  // Email
  const generalEmail = order.company.generalEmail ?? contact?.email
  if (generalEmail) {
    sendGenericEmail({
      to:      generalEmail,
      subject: `Your order ${orderRef} is on the way`,
      text:    `Hi ${name},\n\nYour order ${orderRef} from Flexxo has been dispatched.\n\nTrack your delivery: ${shareLink}\n\nFlexxo Sales Team`,
      html:    `<p>Hi <strong>${name}</strong>,</p><p>Your order <strong>${orderRef}</strong> is on its way!</p><p><a href="${shareLink}" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Track Delivery →</a></p><p>Flexxo Sales Team</p>`,
    }).catch(() => undefined)
  }
}

// ── Send Google Review link after delivery ────────────────────────────────────
export async function sendGoogleReviewRequest(orderId: string): Promise<void> {
  if (!GOOGLE_REVIEW) return

  const order = await prisma.order.findUnique({
    where:   { id: orderId },
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
  })
  if (!order) return

  const contact = order.company.contacts[0]
  const phone   = contact?.whatsapp
  const name    = contact?.name ?? order.company.name
  const email   = order.company.generalEmail ?? contact?.email

  if (phone) {
    sendWabaTemplate(phone, 'order_update', [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: order.referenceNo ?? orderId },
        { type: 'text', text: 'Delivered ✓' },
      ]},
    ]).catch(() => undefined)

    // Simple follow-up for review
    sendWabaTemplate(phone, 'google_review_request', [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: GOOGLE_REVIEW },
      ]},
    ]).catch(() => undefined)
  }

  if (email) {
    sendGenericEmail({
      to:      email,
      subject: `How was your Flexxo delivery? 🌟`,
      text:    `Hi ${name},\n\nWe hope your order ${order.referenceNo ?? ''} arrived well!\n\nWe'd love to hear your feedback:\n${GOOGLE_REVIEW}\n\nThank you for choosing Flexxo!\nFlexxo Sales Team`,
      html:    `<p>Hi <strong>${name}</strong>,</p><p>We hope your order arrived well! 📦</p><p>We'd love to hear your feedback:</p><p><a href="${GOOGLE_REVIEW}" style="background:#f59e0b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Leave a Google Review ⭐</a></p><p>Thank you for choosing Flexxo!<br>Flexxo Sales Team</p>`,
    }).catch(() => undefined)
  }
}

// ── Helper: normalise phone to E.164 for Malaysia ────────────────────────────
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('60')) return `+${digits}`
  if (digits.startsWith('0'))  return `+6${digits}`
  return `+60${digits}`
}
