import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { normalizeName } from '@/lib/normalize'

const CreateSchema = z.object({
  name:        z.string().min(1, 'Supplier name is required.'),
  regNumber:   z.string().optional(),
  paymentTerm: z.string().optional(),
  currency:    z.string().default('MYR'),
})

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
    select: {
      id:          true,
      name:        true,
      paymentTerm: true,
      currency:    true,
      isActive:    true,
      createdAt:   true,
      _count: { select: { priceFiles: true, priceVersions: true } },
    },
  })

  return Response.json(suppliers.map(s => ({
    ...s,
    createdAt:     s.createdAt.toISOString(),
    priceFileCount:    s._count.priceFiles,
    priceVersionCount: s._count.priceVersions,
  })))
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as unknown
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const supplier = await prisma.supplier.create({
    data: {
      name:           parsed.data.name,
      nameNormalized: normalizeName(parsed.data.name),
      regNumber:      parsed.data.regNumber,
      paymentTerm:    parsed.data.paymentTerm,
      currency:       parsed.data.currency,
    },
  })

  return Response.json(supplier, { status: 201 })
}
