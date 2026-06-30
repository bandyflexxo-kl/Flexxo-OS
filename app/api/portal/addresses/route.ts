import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

/**
 * B2B portal delivery addresses for the logged-in customer's company.
 * GET  → the company's saved addresses (to pick at checkout).
 * POST → save a new delivery address (lat/lng captured later at booking).
 */
export async function GET() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.customerCompanyId) return Response.json({ error: 'No company linked.' }, { status: 400 })

  const addresses = await prisma.companyAddress.findMany({
    where:   { companyId: session.customerCompanyId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select:  { id: true, label: true, line1: true, line2: true, city: true, state: true, postcode: true, phone: true, isDefault: true },
  })
  return Response.json({ addresses })
}

const CreateSchema = z.object({
  label:    z.string().trim().max(120).optional(),
  line1:    z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2:    z.string().trim().max(200).optional(),
  city:     z.string().trim().max(100).optional(),
  state:    z.string().trim().max(100).optional(),
  postcode: z.string().trim().max(20).optional(),
  phone:    z.string().trim().max(40).optional(),
  makeDefault: z.boolean().optional(),
})

export async function POST(request: Request) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.customerCompanyId) return Response.json({ error: 'No company linked.' }, { status: 400 })

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  // First address for the company becomes the default automatically.
  const existing = await prisma.companyAddress.count({ where: { companyId: session.customerCompanyId, isActive: true } })
  const isDefault = d.makeDefault === true || existing === 0
  if (isDefault) {
    await prisma.companyAddress.updateMany({
      where: { companyId: session.customerCompanyId, isDefault: true },
      data:  { isDefault: false },
    })
  }

  const address = await prisma.companyAddress.create({
    data: {
      companyId:   session.customerCompanyId,
      addressType: 'delivery',
      label:       d.label ?? null,
      line1:       d.line1,
      line2:       d.line2 ?? null,
      city:        d.city ?? null,
      state:       d.state ?? null,
      postcode:    d.postcode ?? null,
      phone:       d.phone ?? null,
      isDefault,
      isActive:    true,
    },
    select: { id: true, label: true, line1: true, line2: true, city: true, state: true, postcode: true, phone: true, isDefault: true },
  })
  return Response.json({ ok: true, address }, { status: 201 })
}
