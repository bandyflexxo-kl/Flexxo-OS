import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { assertCompanyAccess, isPrivilegedRole } from '@/lib/authorization'

const UpdateSchema = z.object({
  name:            z.string().min(1).max(300).optional(),
  position:        z.string().max(200).optional().nullable(),
  department:      z.string().max(200).optional().nullable(),
  email:           z.string().max(500).optional().nullable(),
  phone:           z.string().max(50).optional().nullable(),
  whatsapp:        z.string().max(50).optional().nullable(),
  isDecisionMaker: z.boolean().optional(),
})

const FIELD_LABELS: Record<string, string> = {
  name:            'Name',
  position:        'Position',
  department:      'Department',
  email:           'Email',
  phone:           'Phone',
  whatsapp:        'WhatsApp',
  isDecisionMaker: 'Decision Maker',
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Forbidden — use edit-request for non-privileged roles' }, { status: 403 })
  }

  const { id } = await params
  const contact = await prisma.contact.findUnique({
    where:  { id },
    select: { id: true, companyId: true, name: true, position: true, department: true, email: true, phone: true, whatsapp: true, isDecisionMaker: true },
  })
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(contact.companyId, session)
  if (denied) return denied

  const body = await request.json() as unknown
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  // Build diff for activity log
  const data = parsed.data
  const changes: string[] = []
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const oldVal = (contact as Record<string, unknown>)[key]
    const newVal = (data as Record<string, unknown>)[key]
    if (newVal !== undefined && String(newVal ?? '') !== String(oldVal ?? '')) {
      changes.push(`${label}: "${oldVal ?? ''}" → "${newVal ?? ''}"`)
    }
  }

  await prisma.$transaction(async tx => {
    await tx.contact.update({ where: { id }, data: { ...data, ...(data.name ? {} : {}) } })
    if (changes.length > 0) {
      await tx.activity.create({
        data: {
          companyId:    contact.companyId,
          userId:       session.userId,
          activityType: 'note',
          subject:      `Contact updated: ${contact.name}`,
          body:         changes.join('\n'),
        },
      })
    }
  })

  return Response.json({ ok: true })
}
