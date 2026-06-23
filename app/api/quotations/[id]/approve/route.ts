import { verifySession }       from '@/lib/session'
import { prisma }               from '@/lib/prisma'
import { isPrivilegedRole }     from '@/lib/authorization'
import { sendPushToUser }       from '@/lib/webpush'
import { z } from 'zod'

const Schema = z.object({
  notes: z.string().optional(),
})

/**
 * Manager / Admin approves a pending_review quotation.
 * Status flow: pending_review → approved
 * Salesperson then clicks "Send to Customer" which sends email + WABA and sets status → sent.
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

  // Approve + log status + log activity in one transaction
  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data:  { status: 'approved', approvedById: session.userId },
    })
    await tx.quotationStatusHistory.create({
      data: {
        quotationId: id,
        fromStatus:  'pending_review',
        toStatus:    'approved',
        changedById: session.userId,
        notes:       parsed.data.notes ? `Approved: ${parsed.data.notes}` : 'Approved — ready to send to customer',
      },
    })
    await tx.activity.create({
      data: {
        companyId:    quotation.companyId,
        activityType: 'note',
        subject:      `Quotation ${quotation.referenceNo} approved`,
        body:         `Approved by ${session.name}. Click "Send to Customer" to email and notify via WhatsApp.`,
        userId:       session.userId,
      },
    })
  })

  // ── Push: notify salesperson to send (fire-and-forget) ───────────────────
  if (quotation.createdById) {
    sendPushToUser(quotation.createdById, {
      title: '✅ Quote Approved — Ready to Send',
      body:  `${quotation.referenceNo ?? 'Your quotation'} was approved by ${session.name}. Open it to send to the customer.`,
      url:   `/quotations/${id}`,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: 'approved' })
}
