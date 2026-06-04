import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  userId:     z.string(),
  fromPhone:  z.string(),
  message:    z.string(),
  receivedAt: z.string(),
})

/**
 * Receives incoming WhatsApp messages forwarded from flexxo-wa-bridge.
 * Creates an inbound Activity on the matching company (looked up via contact phone).
 */
export async function POST(request: Request) {
  // Validate bridge secret
  const auth     = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${process.env.BRIDGE_SECRET ?? ''}`
  if (!process.env.BRIDGE_SECRET || auth !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body   = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

  const { userId, fromPhone, message, receivedAt } = parsed.data

  // Normalise phone for lookup: strip + and spaces
  const normalised = fromPhone.replace(/^\+/, '').replace(/[\s\-]/g, '')

  // Find a contact with a matching whatsapp number
  const contact = await prisma.contact.findFirst({
    where: {
      isActive:  true,
      whatsapp: {
        in: [fromPhone, `+${normalised}`, normalised],
      },
    },
    select: { id: true, companyId: true, name: true },
  })

  if (!contact) {
    // No matching contact — log but don't error (bridge doesn't need to retry)
    console.log(`[webhook] Incoming WhatsApp from ${fromPhone} — no matching contact found`)
    return Response.json({ ok: true, matched: false })
  }

  // Create inbound Activity
  await prisma.activity.create({
    data: {
      companyId:    contact.companyId,
      contactId:    contact.id,
      userId,
      activityType: 'WhatsApp',
      direction:    'Inbound',
      subject:      `WhatsApp from ${contact.name ?? fromPhone}`,
      body:         message,
      createdAt:    new Date(receivedAt),
    },
  })

  return Response.json({ ok: true, matched: true, companyId: contact.companyId })
}
