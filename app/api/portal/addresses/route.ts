import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

/**
 * B2B portal delivery addresses for the logged-in customer's company.
 * Each address is a branch (branchName + contact person + phone + lat/lng) so the
 * customer can pick which branch to deliver to at checkout and manage them in the
 * dashboard. lat/lng are collected here for future Lalamove booking precision.
 *
 * GET    → list the company's saved addresses
 * POST   → create a new address
 * PATCH  → edit an existing address (body.id)
 * DELETE → soft-delete an address (?id=)
 */

const SELECT = {
  id: true, branchName: true, contactPerson: true, label: true,
  line1: true, line2: true, city: true, state: true, postcode: true,
  phone: true, lat: true, lng: true, isDefault: true,
} as const

const FieldsSchema = z.object({
  branchName:    z.string().trim().max(120).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  label:         z.string().trim().max(120).optional(),
  line1:         z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2:         z.string().trim().max(200).optional(),
  city:          z.string().trim().max(100).optional(),
  state:         z.string().trim().max(100).optional(),
  postcode:      z.string().trim().max(20).optional(),
  phone:         z.string().trim().max(40).optional(),
  lat:           z.string().trim().max(32).optional(),
  lng:           z.string().trim().max(32).optional(),
  makeDefault:   z.boolean().optional(),
})

async function requireCompany() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!session.customerCompanyId) return { error: Response.json({ error: 'No company linked.' }, { status: 400 }) }
  return { session, companyId: session.customerCompanyId }
}

export async function GET() {
  const ctx = await requireCompany()
  if ('error' in ctx) return ctx.error
  const addresses = await prisma.companyAddress.findMany({
    where:   { companyId: ctx.companyId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select:  SELECT,
  })
  return Response.json({ addresses })
}

export async function POST(request: Request) {
  const ctx = await requireCompany()
  if ('error' in ctx) return ctx.error

  const parsed = FieldsSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.session.userId}, false)`

  // First address for the company becomes the default automatically.
  const existing  = await prisma.companyAddress.count({ where: { companyId: ctx.companyId, isActive: true } })
  const isDefault = d.makeDefault === true || existing === 0
  if (isDefault) {
    await prisma.companyAddress.updateMany({
      where: { companyId: ctx.companyId, isDefault: true },
      data:  { isDefault: false },
    })
  }

  const address = await prisma.companyAddress.create({
    data: {
      companyId:     ctx.companyId,
      addressType:   'delivery',
      branchName:    d.branchName ?? null,
      contactPerson: d.contactPerson ?? null,
      label:         d.label ?? null,
      line1:         d.line1,
      line2:         d.line2 ?? null,
      city:          d.city ?? null,
      state:         d.state ?? null,
      postcode:      d.postcode ?? null,
      phone:         d.phone ?? null,
      lat:           d.lat ?? null,
      lng:           d.lng ?? null,
      isDefault,
      isActive:      true,
    },
    select: SELECT,
  })
  return Response.json({ ok: true, address }, { status: 201 })
}

export async function PATCH(request: Request) {
  const ctx = await requireCompany()
  if ('error' in ctx) return ctx.error

  const body   = await request.json().catch(() => ({})) as { id?: string }
  const parsed = FieldsSchema.safeParse(body)
  if (!body.id || !parsed.success) return Response.json({ error: parsed.success ? 'Missing id' : parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  // Ownership check — the address must belong to this customer's company.
  const owned = await prisma.companyAddress.findFirst({ where: { id: body.id, companyId: ctx.companyId }, select: { id: true } })
  if (!owned) return Response.json({ error: 'Address not found' }, { status: 404 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.session.userId}, false)`

  if (d.makeDefault === true) {
    await prisma.companyAddress.updateMany({ where: { companyId: ctx.companyId, isDefault: true }, data: { isDefault: false } })
  }

  const address = await prisma.companyAddress.update({
    where: { id: body.id },
    data: {
      branchName:    d.branchName ?? null,
      contactPerson: d.contactPerson ?? null,
      label:         d.label ?? null,
      line1:         d.line1,
      line2:         d.line2 ?? null,
      city:          d.city ?? null,
      state:         d.state ?? null,
      postcode:      d.postcode ?? null,
      phone:         d.phone ?? null,
      lat:           d.lat ?? null,
      lng:           d.lng ?? null,
      ...(d.makeDefault === true ? { isDefault: true } : {}),
    },
    select: SELECT,
  })
  return Response.json({ ok: true, address })
}

export async function DELETE(request: Request) {
  const ctx = await requireCompany()
  if ('error' in ctx) return ctx.error

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const owned = await prisma.companyAddress.findFirst({ where: { id, companyId: ctx.companyId }, select: { id: true, isDefault: true } })
  if (!owned) return Response.json({ error: 'Address not found' }, { status: 404 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.session.userId}, false)`
  await prisma.companyAddress.update({ where: { id }, data: { isActive: false, isDefault: false } })

  // If we removed the default, promote the next remaining address.
  if (owned.isDefault) {
    const next = await prisma.companyAddress.findFirst({
      where: { companyId: ctx.companyId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
    })
    if (next) await prisma.companyAddress.update({ where: { id: next.id }, data: { isDefault: true } })
  }
  return Response.json({ ok: true })
}
