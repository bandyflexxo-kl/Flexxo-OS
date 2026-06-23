import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { Prisma } from '@/app/generated/prisma/client'
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
      company:    { select: { id: true, name: true } },
      contact:    { select: { id: true, name: true } },
      createdBy:  { select: { name: true } },
      approvedBy: { select: { name: true } },
      items: {
        include: { product: { select: { id: true, name: true, brand: true, unit: true, qneItemCode: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      statusHistory: {
        orderBy: { changedAt: 'desc' },
        include: { changedBy: { select: { name: true } } },
      },
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
    subtotal:        quotation.subtotal?.toString()        ?? null,
    discountAmount:  quotation.discountAmount?.toString()  ?? null,
    totalAmount:     quotation.totalAmount?.toString()     ?? null,
    termsConditions: quotation.termsConditions,
    internalNotes:   quotation.internalNotes,
    sentAt:          quotation.sentAt?.toISOString()       ?? null,
    expiresAt:       quotation.expiresAt?.toISOString()    ?? null,
    createdAt:       quotation.createdAt.toISOString(),
    company:         quotation.company,
    contact:         quotation.contact,
    createdBy:       quotation.createdBy,
    approvedBy:      quotation.approvedBy,
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
      changedBy:   h.changedBy,
    })),
  })
}

const UpdateSchema = z.object({
  status:            z.string().optional(),
  termsConditions:   z.string().optional().nullable(),
  internalNotes:     z.string().optional().nullable(),
  expiresAt:         z.string().optional().nullable(),
  discountPct:       z.number().min(0).max(100).optional().nullable(),
  deliveryAddress:   z.string().max(1000).optional().nullable(),
  deliveryRecipient: z.string().max(200).optional().nullable(),
  deliveryPhone:     z.string().max(50).optional().nullable(),
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

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true, companyId: true, subtotal: true, taxAmount: true },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  const data = parsed.data
  const prevStatus = quotation.status

  // Compute discount and new total when discountPct is provided
  let discountAmount: Prisma.Decimal | null = null
  let totalAmount:    Prisma.Decimal | null = null
  if (data.discountPct !== undefined) {
    const subtotal = quotation.subtotal ?? new Prisma.Decimal(0)
    const tax      = quotation.taxAmount ?? new Prisma.Decimal(0)
    discountAmount = data.discountPct
      ? subtotal.times(new Prisma.Decimal(data.discountPct).dividedBy(100)).toDecimalPlaces(4)
      : new Prisma.Decimal(0)
    totalAmount = subtotal.minus(discountAmount).plus(tax).toDecimalPlaces(4)
  }

  await prisma.$transaction(async tx => {
    await tx.quotation.update({
      where: { id },
      data: {
        ...(data.status          !== undefined ? { status:          data.status          } : {}),
        ...(data.termsConditions !== undefined ? { termsConditions: data.termsConditions ?? null } : {}),
        ...(data.internalNotes   !== undefined ? { internalNotes:   data.internalNotes   ?? null } : {}),
        ...(data.expiresAt       !== undefined ? { expiresAt:       data.expiresAt ? new Date(data.expiresAt) : null } : {}),
        ...(discountAmount !== null              ? { discountAmount, totalAmount }                     : {}),
        ...(data.deliveryAddress   !== undefined ? { deliveryAddress:   data.deliveryAddress   ?? null } : {}),
        ...(data.deliveryRecipient !== undefined ? { deliveryRecipient: data.deliveryRecipient ?? null } : {}),
        ...(data.deliveryPhone     !== undefined ? { deliveryPhone:     data.deliveryPhone     ?? null } : {}),
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
