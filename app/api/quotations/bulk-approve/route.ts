import { z }                    from 'zod'
import { verifySession }         from '@/lib/session'
import { prisma }                from '@/lib/prisma'
import { isPrivilegedRole }      from '@/lib/authorization'
import { sendQuotationEmail }    from '@/lib/quotationEmail'
import { sendPushToUser }        from '@/lib/webpush'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})

/**
 * Bulk-approve pending_review quotations.
 * Non-pending_review quotations in the list are silently skipped.
 * Emails + push notifications fired per quotation (fire-and-forget).
 */
export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role))
    return Response.json({ error: 'Only Managers, Directors and Admins can approve quotations.' }, { status: 403 })

  const body = await request.json()
  const result = schema.safeParse(body)
  if (!result.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { ids } = result.data

  const quotations = await prisma.quotation.findMany({
    where:  { id: { in: ids }, status: 'pending_review' },
    select: {
      id: true, referenceNo: true, currency: true, totalAmount: true,
      expiresAt: true, createdById: true, companyId: true,
      company:   { select: { name: true, generalEmail: true } },
      contact:   { select: { name: true, email: true } },
      createdBy: { select: { name: true } },
    },
  })

  const now = new Date()

  // Approve all qualifying quotations in a single transaction
  await prisma.$transaction([
    prisma.quotation.updateMany({
      where: { id: { in: quotations.map(q => q.id) } },
      data:  { status: 'sent', sentAt: now, approvedById: session.userId },
    }),
    ...quotations.map(q =>
      prisma.quotationStatusHistory.create({
        data: {
          quotationId: q.id,
          fromStatus:  'pending_review',
          toStatus:    'sent',
          changedById: session.userId,
          notes:       'Bulk approved and auto-sent to customer',
        },
      }),
    ),
  ])

  // Emails + push notifications — fire-and-forget per quotation
  for (const q of quotations) {
    const recipientEmail = q.contact?.email ?? q.company.generalEmail
    if (recipientEmail) {
      sendQuotationEmail({
        to:              recipientEmail,
        contactName:     q.contact?.name ?? null,
        salespersonName: q.createdBy.name,
        companyName:     q.company.name,
        referenceNo:     q.referenceNo,
        currency:        q.currency,
        totalAmount:     q.totalAmount?.toString() ?? '0',
        expiresAt:       q.expiresAt?.toISOString() ?? null,
        quotationId:     q.id,
      }).catch(err => console.error(`Bulk approve email failed for ${q.referenceNo}:`, err))
    }
    sendPushToUser(q.createdById, {
      title: '✅ Quote Approved & Sent',
      body:  `${q.referenceNo} was approved by ${session.name} and emailed to the client.`,
      url:   `/quotations/${q.id}`,
    }).catch(() => undefined)
  }

  return Response.json({ approved: quotations.length, skipped: ids.length - quotations.length })
}
