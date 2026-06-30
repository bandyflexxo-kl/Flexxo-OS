import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendQuotationEmail } from '@/lib/quotationEmail'
import { sendQuotationWhatsApp } from '@/lib/wabaMessages'
import { getQuotationRecipients, resolveRecipients } from '@/lib/quotationRecipients'
import { z } from 'zod'

const BodySchema = z.object({ emails: z.array(z.string().email()).optional() })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
  const requestedEmails = parsed.success ? parsed.data.emails : undefined

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: {
      id: true, status: true, companyId: true,
      referenceNo: true, currency: true, totalAmount: true, expiresAt: true,
      company: { select: { name: true, generalEmail: true } },
      contact: { select: { id: true, name: true, email: true, whatsapp: true } },
      createdBy: { select: { name: true } },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  if (quotation.status !== 'sent') {
    return Response.json({ error: 'Only sent quotations can be resent.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  // Resolve recipient email(s) from the sender's multi-select, validated against
  // the company-email + contact-email allow-list (falls back to the default).
  const allRecipients = await getQuotationRecipients(id)
  const recipientEmails = resolveRecipients(allRecipients, requestedEmails)

  if (recipientEmails.length === 0) {
    return Response.json(
      { error: 'No email address on file for this contact or company. Add an email before sending.' },
      { status: 400 },
    )
  }
  const recipientEmail = recipientEmails.join(', ')

  // Attempt email — fail fast with a clear error if SMTP is broken
  try {
    await sendQuotationEmail({
      to:              recipientEmails,
      contactName:     quotation.contact?.name ?? null,
      salespersonName: quotation.createdBy.name,
      companyName:     quotation.company.name,
      referenceNo:     quotation.referenceNo,
      currency:        quotation.currency,
      totalAmount:     quotation.totalAmount?.toString() ?? '0',
      expiresAt:       quotation.expiresAt?.toISOString() ?? null,
      quotationId:     id,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isAuth = msg.includes('535') || msg.includes('EAUTH') || msg.includes('Password not accepted')
    return Response.json(
      {
        error: isAuth
          ? 'Email failed: Gmail app password rejected. Go to myaccount.google.com/apppasswords, generate a new one, and update GMAIL_APP_PASSWORD in .env.local.'
          : `Email delivery failed: ${msg.slice(0, 200)}`,
      },
      { status: 500 },
    )
  }

  // Log the resend as an activity
  await prisma.activity.create({
    data: {
      companyId:    quotation.companyId,
      activityType: 'email',
      direction:    'outbound',
      subject:      `Quotation ${quotation.referenceNo} resent to customer`,
      body:         `Quotation resent to ${recipientEmail} by ${session.name}`,
      userId:       session.userId,
    },
  })

  // WABA WhatsApp — use quotation's contact, or fall back to first company contact with WhatsApp
  const wabaContact = quotation.contact?.whatsapp
    ? quotation.contact
    : await prisma.contact.findFirst({
        where:  { companyId: quotation.companyId, isActive: true, whatsapp: { not: null } },
        select: { id: true, name: true, whatsapp: true },
      })

  let wabaResult: { ok: boolean; detail: string }
  if (wabaContact?.whatsapp) {
    const result = await sendQuotationWhatsApp({
      contactName:  wabaContact.name,
      contactPhone: wabaContact.whatsapp,
      companyId:    quotation.companyId,
      contactId:    wabaContact.id,
      userId:       session.userId,
      referenceNo:  quotation.referenceNo,
      quotationId:  id,
    })
    wabaResult = result.ok
      ? { ok: true,  detail: `Sent to ${wabaContact.whatsapp}` }
      : { ok: false, detail: result.error }
  } else {
    wabaResult = { ok: false, detail: 'No contact with WhatsApp number found for this company' }
  }

  return Response.json({ ok: true, sentTo: recipientEmail, waba: wabaResult })
}
