import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendQuotationEmail } from '@/lib/quotationEmail'
import { sendQuotationWhatsApp } from '@/lib/wabaMessages'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: {
      id: true, status: true, companyId: true,
      referenceNo: true, currency: true, totalAmount: true, expiresAt: true,
      company: {
        select: { name: true, generalEmail: true },
      },
      contact: {
        select: { id: true, name: true, email: true, whatsapp: true },
      },
      createdBy: { select: { name: true } },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  // Only approved quotations can be sent
  if (quotation.status !== 'approved') {
    return Response.json(
      { error: quotation.status === 'pending_review'
          ? 'This quotation is awaiting manager approval before it can be sent.'
          : quotation.status === 'draft'
          ? 'Submit this quotation for approval before sending.'
          : `Cannot send a quotation with status "${quotation.status}".`
      },
      { status: 400 },
    )
  }

  const itemCount = await prisma.quotationItem.count({ where: { quotationId: id } })
  if (itemCount === 0) {
    return Response.json({ error: 'Add at least one item before sending.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  // Determine recipient email and WhatsApp
  const recipientEmail = quotation.contact?.email ?? quotation.company.generalEmail

  if (!recipientEmail) {
    return Response.json(
      { error: 'No email address on file for this contact or company. Add an email before sending.' },
      { status: 400 },
    )
  }

  // ── Attempt email FIRST — if SMTP is broken, fail before touching the DB ──
  try {
    await sendQuotationEmail({
      to:              recipientEmail,
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

  // ── Email succeeded — commit status to DB ─────────────────────────────────
  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'sent', sentAt: new Date() },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'approved',
        toStatus:    'sent',
        changedById: session.userId,
      },
    })
    await tx.activity.create({
      data: {
        companyId:    quotation.companyId,
        activityType: 'email',
        direction:    'outbound',
        subject:      `Quotation ${quotation.referenceNo} sent to customer`,
        body:         `Quotation emailed to ${recipientEmail}`,
        userId:       session.userId,
      },
    })
  })

  // ── WABA WhatsApp (fire-and-forget — never blocks the response) ───────────
  if (quotation.contact?.whatsapp) {
    sendQuotationWhatsApp({
      contactName:  quotation.contact.name,
      contactPhone: quotation.contact.whatsapp,
      companyId:    quotation.companyId,
      contactId:    quotation.contact.id,
      userId:       session.userId,
      referenceNo:  quotation.referenceNo,
      quotationId:  id,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'sent', emailSent: true, sentTo: recipientEmail })
}
