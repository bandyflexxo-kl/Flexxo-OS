import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'

const ContactSchema = z.object({
  companyId: z.string(),
  name: z.string().min(1, { error: 'Name is required.' }),
  position: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  isDecisionMaker: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')

  const contacts = await prisma.contact.findMany({
    where: { isActive: true, ...(companyId ? { companyId } : {}) },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
    take: 200,
  })

  return Response.json(contacts)
}

export async function POST(req: NextRequest) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = ContactSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const d = parsed.data
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const contact = await prisma.contact.create({
    data: {
      companyId: d.companyId,
      name: d.name,
      position: d.position || null,
      email: d.email || null,
      phone: d.phone || null,
      whatsapp: d.whatsapp || null,
      isDecisionMaker: d.isDecisionMaker ?? false,
      createdById: session.userId,
    },
  })

  return Response.json(contact, { status: 201 })
}
