import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { sendWhatsApp } from '@/lib/whatsappClient'
import { z } from 'zod'

const Schema = z.object({
  contactId: z.string().optional(),   // if omitted, uses primary contact with whatsapp
  message:   z.string().min(1).max(4000),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: companyId } = await params
  const body    = await request.json() as unknown
  const parsed  = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const denied = await assertCompanyAccess(companyId, session)
  if (denied) return denied

  // Find the target contact
  let contact: { id: string; name: string | null; whatsapp: string | null } | null = null

  if (parsed.data.contactId) {
    contact = await prisma.contact.findFirst({
      where:  { id: parsed.data.contactId, companyId, isActive: true },
      select: { id: true, name: true, whatsapp: true },
    })
  } else {
    // Default: primary contact with a whatsapp number
    contact = await prisma.contact.findFirst({
      where:   { companyId, isActive: true, whatsapp: { not: null } },
      orderBy: { isDecisionMaker: 'desc' },
      select:  { id: true, name: true, whatsapp: true },
    })
  }

  if (!contact) {
    return Response.json({ error: 'No contact found for this company.' }, { status: 404 })
  }
  if (!contact.whatsapp) {
    return Response.json({ error: 'This contact has no WhatsApp number saved.' }, { status: 422 })
  }

  // Send via bridge
  const result = await sendWhatsApp(session.userId, contact.whatsapp, parsed.data.message)

  if (!result.ok) {
    return Response.json(
      { error: `WhatsApp send failed: ${result.error}` },
      { status: 422 },
    )
  }

  // Log as outbound Activity
  await prisma.activity.create({
    data: {
      companyId,
      contactId:    contact.id,
      userId:       session.userId,
      activityType: 'WhatsApp',
      direction:    'Outbound',
      subject:      `WhatsApp to ${contact.name ?? contact.whatsapp}`,
      body:         parsed.data.message,
      linkedEntityType: null,
      linkedEntityId:   null,
    },
  })

  return Response.json({ ok: true, messageId: result.messageId })
}
