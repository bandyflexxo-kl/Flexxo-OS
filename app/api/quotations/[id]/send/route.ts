import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendQuotationEmail } from '@/lib/quotationEmail'

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
        select: { name: true, email: true },
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

  // Determine recipient email
  const recipientEmail = quotation.contact?.email ?? quotation.company.generalEmail

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
    // Log as outbound email activity
    if (recipientEmail) {
      await tx.activity.create({
        data: {
          companyId:    quotation.companyId,
          activityType: 'email',
          direction:    'outbound',
          subject:      `Quotation ${quotation.referenceNo} sent to customer`,
          body:         `Quotation sent to ${recipientEmail}`,
          userId:       session.userId,
        },
      })
    }
  })

  // Send email (outside transaction — email failure should not roll back status change)
  if (recipientEmail) {
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
      // Email failure is non-fatal — quotation is already marked sent
      console.error('Failed to send quotation email:', err)
    }
  }

  return Response.json({ ok: true, status: 'sent', emailSent: !!recipientEmail })
}
