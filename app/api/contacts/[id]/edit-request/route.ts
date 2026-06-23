import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { assertCompanyAccess } from '@/lib/authorization'

const ChangesSchema = z.object({
  name:            z.string().min(1).max(300).optional(),
  position:        z.string().max(200).optional().nullable(),
  department:      z.string().max(200).optional().nullable(),
  email:           z.string().max(500).optional().nullable(),
  phone:           z.string().max(50).optional().nullable(),
  whatsapp:        z.string().max(50).optional().nullable(),
  isDecisionMaker: z.boolean().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const contact = await prisma.contact.findUnique({
    where:  { id },
    select: { id: true, companyId: true, name: true },
  })
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(contact.companyId, session)
  if (denied) return denied

  const body = await request.json() as unknown
  const parsed = ChangesSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: 'No changes provided' }, { status: 400 })
  }

  // Cancel any existing pending request for this contact from this user
  await prisma.contactEditRequest.updateMany({
    where:  { contactId: id, requestedById: session.userId, status: 'pending' },
    data:   { status: 'superseded', rejectedAt: new Date() },
  })

  const req = await prisma.contactEditRequest.create({
    data: {
      contactId:     id,
      requestedById: session.userId,
      changes:       parsed.data,
      status:        'pending',
    },
  })

  return Response.json({ ok: true, requestId: req.id }, { status: 201 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const contact = await prisma.contact.findUnique({
    where:  { id },
    select: { id: true, companyId: true },
  })
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(contact.companyId, session)
  if (denied) return denied

  const requests = await prisma.contactEditRequest.findMany({
    where:   { contactId: id, status: 'pending' },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take:    5,
  })

  return Response.json(requests)
}
