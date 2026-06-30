import 'server-only'
import { prisma } from '@/lib/prisma'
import { sendWabaTemplate, type WabaTemplateComponent, type WabaSendResult } from '@/lib/wabaClient'

// ── WABA message senders ──────────────────────────────────────────────────────
//
// Templates required in Meta Business Manager (under WhatsApp Manager → Templates):
//
//   quotation_ready  (UTILITY category)
//     Body: "Hi {{1}}, your quotation {{2}} is ready. You can view and respond here: {{3}}"
//
//   order_update     (UTILITY category)
//     Body: "Hi {{1}}, your Flexxo order {{2}} status has been updated to: {{3}}"
//

// PORTAL_URL: publicly-accessible shop URL used in WhatsApp links (same as email).
// Customer links must point at the public shop domain — NOT NEXTAUTH_URL (the
// CMS/auth host, which is flexxo-os.vercel.app in prod). Override only for local.
const PORTAL_URL = process.env.PORTAL_URL ?? 'https://shop.flexxo.com.my'

// ── Quotation sent ────────────────────────────────────────────────────────────

/**
 * Sends "quotation_ready" template to the contact and logs a WhatsApp activity.
 * Returns the WabaSendResult so callers can report success/failure to the UI.
 */
export async function sendQuotationWhatsApp(params: {
  contactName:   string | null
  contactPhone:  string
  companyId:     string
  contactId:     string | null
  userId:        string
  referenceNo:   string | null
  quotationId:   string
  totalAmount?:  string | null
}): Promise<WabaSendResult> {
  const { contactName, contactPhone, companyId, contactId, userId, referenceNo, quotationId, totalAmount } = params

  const name    = contactName ?? 'there'
  const refNo   = referenceNo ?? 'your quotation'
  const viewUrl = `${PORTAL_URL}/shop/quotations/${quotationId}`
  const amtText = totalAmount ? `MYR ${Number(totalAmount).toFixed(2)}` : ''

  // Try template with quick-reply buttons first (quotation_ready_buttons).
  // Falls back to plain template (quotation_ready) if button template is not yet approved.
  const buttonComponents: WabaTemplateComponent[] = [
    {
      type:       'body',
      parameters: [
        { type: 'text', text: name },
        { type: 'text', text: refNo },
        { type: 'text', text: amtText },
        { type: 'text', text: viewUrl },
      ],
    },
    {
      type:     'button',
      sub_type: 'quick_reply',
      index:    '0',
      parameters: [{ type: 'payload', payload: `ACCEPT_${quotationId}` }],
    },
    {
      type:     'button',
      sub_type: 'quick_reply',
      index:    '1',
      parameters: [{ type: 'payload', payload: `DECLINE_${quotationId}` }],
    },
  ]

  let result = await sendWabaTemplate(contactPhone, 'quotation_ready_buttons', buttonComponents)

  // Fallback to plain template if button template isn't available
  if (!result.ok) {
    const plainComponents: WabaTemplateComponent[] = [
      {
        type:       'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: refNo },
          { type: 'text', text: viewUrl },
        ],
      },
    ]
    result = await sendWabaTemplate(contactPhone, 'quotation_ready', plainComponents)
  }

  if (result.ok) {
    await prisma.activity.create({
      data: {
        companyId,
        contactId:    contactId ?? undefined,
        userId,
        activityType: 'WhatsApp',
        direction:    'Outbound',
        subject:      `WhatsApp: Quotation ${refNo} sent`,
        body:         `Template sent to ${contactPhone} (Msg ID: ${result.messageId})`,
        linkedEntityType: 'Quotation',
        linkedEntityId:   quotationId,
      },
    }).catch(err => console.error('[WABA] Failed to log quotation WhatsApp activity:', err))
  }

  return result
}

// ── Driver assigned / live tracking ──────────────────────────────────────────

/**
 * Sends "order_update" template when a Lalamove driver is assigned (ON_GOING).
 * Includes the live tracking link in the status text.
 * Called by the Lalamove webhook — fire-and-forget.
 */
export async function sendDeliveryTrackingWhatsApp(params: {
  companyId:   string
  orderId:     string
  orderRef:    string
  trackingUrl: string | null
  userId:      string
}): Promise<void> {
  const { companyId, orderId, orderRef, trackingUrl, userId } = params

  const contact = await prisma.contact.findFirst({
    where:   { companyId, isActive: true, whatsapp: { not: null } },
    orderBy: { isDecisionMaker: 'desc' },
    select:  { id: true, name: true, whatsapp: true },
  })

  if (!contact?.whatsapp) return

  const statusText = trackingUrl
    ? `Out for Delivery 🚚 Track your driver: ${trackingUrl}`
    : 'Out for Delivery 🚚 Your driver is on the way!'

  const components: WabaTemplateComponent[] = [
    {
      type:       'body',
      parameters: [
        { type: 'text', text: contact.name ?? 'there' },
        { type: 'text', text: orderRef },
        { type: 'text', text: statusText },
      ],
    },
  ]

  const result = await sendWabaTemplate(contact.whatsapp, 'order_update', components)

  if (result.ok) {
    await prisma.activity.create({
      data: {
        companyId,
        contactId:        contact.id,
        userId,
        activityType:     'WhatsApp',
        direction:        'Outbound',
        subject:          `WhatsApp: Order ${orderRef} — Driver Assigned`,
        body:             `Tracking link sent to ${contact.whatsapp} (Msg ID: ${result.messageId})`,
        linkedEntityType: 'Order',
        linkedEntityId:   orderId,
      },
    }).catch(err => console.error('[WABA] Failed to log tracking WhatsApp activity:', err))
  }
}

// ── Order status change ───────────────────────────────────────────────────────

/**
 * Sends "order_update" template when order status changes to Shipped or Delivered.
 * Call this AFTER the DB transaction that updates the order status.
 */
export async function sendOrderStatusWhatsApp(params: {
  companyId:    string
  orderId:      string
  orderRef:     string
  newStatus:    string
  userId:       string           // manager/admin who changed status (for activity log)
}): Promise<void> {
  const { companyId, orderId, orderRef, newStatus, userId } = params

  const NOTIFIABLE = ['Confirmed', 'Approved', 'Shipped', 'Delivered']
  if (!NOTIFIABLE.includes(newStatus)) return

  // Find the primary contact with a whatsapp number for this company
  const contact = await prisma.contact.findFirst({
    where:   { companyId, isActive: true, whatsapp: { not: null } },
    orderBy: { isDecisionMaker: 'desc' },  // prefer decision maker
    select:  { id: true, name: true, whatsapp: true },
  })

  if (!contact?.whatsapp) return  // no WhatsApp number on file — skip silently

  const statusLabel: Record<string, string> = {
    Confirmed: 'Confirmed — thank you! We will prepare your order shortly.',
    Approved:  'Approved — your order is being picked and packed.',
    Shipped:   'Shipped — on the way to you!',
    Delivered: 'Delivered — enjoy your order! 😊',
  }

  const components: WabaTemplateComponent[] = [
    {
      type:       'body',
      parameters: [
        { type: 'text', text: contact.name ?? 'there' },
        { type: 'text', text: orderRef },
        { type: 'text', text: statusLabel[newStatus] ?? newStatus },
      ],
    },
  ]

  const result = await sendWabaTemplate(contact.whatsapp, 'order_update', components)

  if (result.ok) {
    await prisma.activity.create({
      data: {
        companyId,
        contactId:    contact.id,
        userId,
        activityType: 'WhatsApp',
        direction:    'Outbound',
        subject:      `WhatsApp: Order ${orderRef} — ${newStatus}`,
        body:         `Template "order_update" sent to ${contact.whatsapp} (Msg ID: ${result.messageId})`,
        linkedEntityType: 'Order',
        linkedEntityId:   orderId,
      },
    }).catch(err => console.error('[WABA] Failed to log order WhatsApp activity:', err))
  }
}
