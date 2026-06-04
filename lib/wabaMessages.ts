import 'server-only'
import { prisma } from '@/lib/prisma'
import { sendWabaTemplate, type WabaTemplateComponent } from '@/lib/wabaClient'

// ── WABA message senders ──────────────────────────────────────────────────────
//
// All functions are fire-and-forget: they never throw and never block callers.
// Each function sends the template and logs an Activity record on success.
//
// Templates required in Meta Business Manager (under WhatsApp Manager → Templates):
//
//   quotation_ready  (UTILITY category)
//     Body: "Hi {{1}}, your quotation {{2}} is ready. You can view and respond here: {{3}}"
//
//   order_update     (UTILITY category)
//     Body: "Hi {{1}}, your Flexxo order {{2}} status has been updated to: {{3}}"
//

const APP_URL = process.env.NEXTAUTH_URL ?? 'https://flexxo-os.vercel.app'

// ── Quotation sent ────────────────────────────────────────────────────────────

/**
 * Sends "quotation_ready" template to the contact and logs a WhatsApp activity.
 * Call this AFTER the DB transaction that marks the quotation as 'sent'.
 */
export async function sendQuotationWhatsApp(params: {
  contactName:   string | null
  contactPhone:  string          // from contact.whatsapp field
  companyId:     string
  contactId:     string | null
  userId:        string          // salesperson (for activity log)
  referenceNo:   string | null
  quotationId:   string
}): Promise<void> {
  const { contactName, contactPhone, companyId, contactId, userId, referenceNo, quotationId } = params

  const name    = contactName ?? 'there'
  const refNo   = referenceNo ?? 'your quotation'
  const viewUrl = `${APP_URL}/shop/quotations/${quotationId}`

  const components: WabaTemplateComponent[] = [
    {
      type:       'body',
      parameters: [
        { type: 'text', text: name },
        { type: 'text', text: refNo },
        { type: 'text', text: viewUrl },
      ],
    },
  ]

  const result = await sendWabaTemplate(contactPhone, 'quotation_ready', components)

  if (result.ok) {
    // Log as outbound WhatsApp activity (best-effort, don't throw)
    await prisma.activity.create({
      data: {
        companyId,
        contactId:    contactId ?? undefined,
        userId,
        activityType: 'WhatsApp',
        direction:    'Outbound',
        subject:      `WhatsApp: Quotation ${refNo} sent`,
        body:         `Template "quotation_ready" sent to ${contactPhone} (Msg ID: ${result.messageId})`,
        linkedEntityType: 'Quotation',
        linkedEntityId:   quotationId,
      },
    }).catch(err => console.error('[WABA] Failed to log quotation WhatsApp activity:', err))
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

  // Only send for Shipped and Delivered — don't spam for every status
  if (newStatus !== 'Shipped' && newStatus !== 'Delivered') return

  // Find the primary contact with a whatsapp number for this company
  const contact = await prisma.contact.findFirst({
    where:   { companyId, isActive: true, whatsapp: { not: null } },
    orderBy: { isDecisionMaker: 'desc' },  // prefer decision maker
    select:  { id: true, name: true, whatsapp: true },
  })

  if (!contact?.whatsapp) return  // no WhatsApp number on file — skip silently

  const components: WabaTemplateComponent[] = [
    {
      type:       'body',
      parameters: [
        { type: 'text', text: contact.name ?? 'there' },
        { type: 'text', text: orderRef },
        { type: 'text', text: newStatus },
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
