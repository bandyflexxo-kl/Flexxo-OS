import { verifySession }       from '@/lib/session'
import { prisma }               from '@/lib/prisma'
import { isPrivilegedRole }     from '@/lib/authorization'
import { sendPushToUser }       from '@/lib/webpush'
import { sendQuotationEmail }   from '@/lib/quotationEmail'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().optional(),
})

/**
 * Manager / Admin approves a pending_review quotation.
 * Status flow: pending_review → sent  (auto-send on approval — no extra click needed)
 * The quotation email is sent immediately after approval.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Only Managers and Admins can approve quotations.' }, { status: 403 })
  }

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: {
      id: true, status: true, referenceNo: true, createdById: true,
      companyId: true, currency: true, totalAmount: true, expiresAt: true,
      company:   { select: { name: true, generalEmail: true } },
      contact:   { select: { id: true, name: true, email: true, whatsapp: true } },
      createdBy: { select: { name: true } },
    },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  if (quotation.status !== 'pending_review') {
    return Response.json(
      { error: `Only pending_review quotations can be approved. Current status: ${quotation.status}` },
      { status: 400 },
    )
  }

  const itemCount = await prisma.quotationItem.count({ where: { quotationId: id } })
  const recipientEmail = quotation.contact?.email ?? quotation.company.generalEmail

  // Approve + log status + log activity in one transaction
  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'sent', sentAt: new Date(), approvedById: session.userId },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'pending_review',
        toStatus:    'sent',
        changedById: session.userId,
        notes:       parsed.data.notes ? `Approved & sent: ${parsed.data.notes}` : 'Approved and auto-sent to customer',
      },
    })
    if (recipientEmail) {
      await tx.activity.create({
        data: {
          companyId:    quotation.companyId,
          activityType: 'email',
          direction:    'outbound',
          subject:      `Quotation ${quotation.referenceNo} approved and sent to customer`,
          body:         `Approved by ${session.name}. Email sent to ${recipientEmail}.`,
          userId:       session.userId,
        },
      })
    }
  })

  // ── Send email (outside transaction — failure doesn't roll back approval) ──
  if (recipientEmail && itemCount > 0) {
    sendQuotationEmail({
      to:              recipientEmail,
      contactName:     quotation.contact?.name ?? null,
      salespersonName: quotation.createdBy.name,
      companyName:     quotation.company.name,
      referenceNo:     quotation.referenceNo,
      currency:        quotation.currency,
      totalAmount:     quotation.totalAmount?.toString() ?? '0',
      expiresAt:       quotation.expiresAt?.toISOString() ?? null,
      quotationId:     id,
    }).catch(err => console.error('Quotation auto-send email failed:', err))
  }

  // ── Push: notify salesperson (fire-and-forget) ────────────────────────────
  if (quotation.createdById) {
    sendPushToUser(quotation.createdById, {
      title: '✅ Quote Approved & Sent',
      body:  `${quotation.referenceNo ?? 'Your quotation'} was approved by ${session.name} and emailed to the client.`,
      url:   `/quotations/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'sent', emailSent: !!(recipientEmail && itemCount > 0) })
}
