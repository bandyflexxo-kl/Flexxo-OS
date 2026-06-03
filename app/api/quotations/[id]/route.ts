import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { z } from 'zod'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:   { id },
    include: {
      company:   { select: { id: true, name: true } },
      contact:   { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: { product: { select: { id: true, name: true, brand: true, unit: true, qneItemCode: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      statusHistory: { orderBy: { changedAt: 'desc' } },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  return Response.json({
    id:              quotation.id,
    referenceNo:     quotation.referenceNo,
    status:          quotation.status,
    currency:        quotation.currency,
    subtotal:        quotation.subtotal?.toString()      ?? null,
    totalAmount:     quotation.totalAmount?.toString()   ?? null,
    termsConditions: quotation.termsConditions,
    internalNotes:   quotation.internalNotes,
    sentAt:          quotation.sentAt?.toISOString()     ?? null,
    expiresAt:       quotation.expiresAt?.toISOString()  ?? null,
    createdAt:       quotation.createdAt.toISOString(),
    company:         quotation.company,
    contact:         quotation.contact,
    createdBy:       quotation.createdBy,
    items: quotation.items.map(i => ({
      id:          i.id,
      description: i.description,
      brand:       i.brand,
      unit:        i.unit,
      qty:         i.qty.toString(),
      unitCost:    i.unitCost?.toString()  ?? null,
      unitPrice:   i.unitPrice.toString(),
      marginPct:   i.marginPct?.toString() ?? null,
      lineTotal:   i.lineTotal.toString(),
      sortOrder:   i.sortOrder,
      product:     i.product,
    })),
    statusHistory: quotation.statusHistory.map(h => ({
      fromStatus:  h.fromStatus,
      toStatus:    h.toStatus,
      notes:       h.notes,
      changedAt:   h.changedAt.toISOString(),
    })),
  })
}

const UpdateSchema = z.object({
  status:          z.string().optional(),
  termsConditions: z.string().optional().nullable(),
  internalNotes:   z.string().optional().nullable(),
  expiresAt:       z.string().optional().nullable(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({ where: { id }, select: { id: true, status: true, companyId: true } })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  const data = parsed.data
  const prevStatus = quotation.status

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data: {
        ...(data.status          !== undefined ? { status:          data.status          } : {}),
        ...(data.termsConditions !== undefined ? { termsConditions: data.termsConditions ?? null } : {}),
        ...(data.internalNotes   !== undefined ? { internalNotes:   data.internalNotes   ?? null } : {}),
        ...(data.expiresAt       !== undefined ? { expiresAt:       data.expiresAt ? new Date(data.expiresAt) : null } : {}),
      },
    })
    if (data.status && data.status !== prevStatus) {
      await tx.quotationStatusHistory.create({
        data: {
          quotationId: id,
          fromStatus:  prevStatus,
          toStatus:    data.status,
          changedById: session.userId,
        },
      })
    }
  })

  return Response.json({ ok: true })
}
