import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { companyOwnerFilter } from '@/lib/authorization'
import { z } from 'zod'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ownerFilter = companyOwnerFilter(session)

  const quotations = await prisma.quotation.findMany({
    where: {
      status:  { not: 'cart' },
      company: ownerFilter,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      company:   { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count:    { select: { items: true } },
    },
    take: 200,
  })

  return Response.json(quotations.map(q => ({
    id:          q.id,
    referenceNo: q.referenceNo,
    status:      q.status,
    totalAmount: q.totalAmount?.toString() ?? null,
    currency:    q.currency,
    company:     q.company,
    createdBy:   q.createdBy,
    itemCount:   q._count.items,
    createdAt:   q.createdAt.toISOString(),
    sentAt:      q.sentAt?.toISOString() ?? null,
  })))
}

const CreateSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
})

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await request.json() as unknown
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const year   = new Date().getFullYear()
  const count  = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  const refNo  = `QT-${year}-${String(count + 1).padStart(4, '0')}`

  const quotation = await prisma.quotation.create({
    data: {
      companyId:     parsed.data.companyId,
      contactId:     parsed.data.contactId,
      createdById:   session.userId,
      referenceNo:   refNo,
      status:        'draft',
      currency:      'MYR',
      versionNumber: 1,
    },
  })

  return Response.json({ id: quotation.id, referenceNo: quotation.referenceNo }, { status: 201 })
}
