import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'

async function recalcTotals(quotationId: string, tx: Prisma.TransactionClient) {
  const items    = await tx.quotationItem.findMany({ where: { quotationId } })
  const subtotal = items.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0))
  await tx.quotation.update({
    where: { id: quotationId },
    data:  { subtotal, totalAmount: subtotal },
  })
}

const PatchSchema = z.object({
  qty:       z.number().positive().optional(),
  unitPrice: z.number().positive().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params
  const body           = await request.json() as unknown
  const parsed         = PatchSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const [quotation, item] = await Promise.all([
    prisma.quotation.findUnique({ where: { id }, select: { status: true, companyId: true } }),
    prisma.quotationItem.findUnique({ where: { id: itemId, quotationId: id } }),
  ])

  if (!quotation || !item) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!['draft', 'pending_review'].includes(quotation.status)) {
    return Response.json({ error: 'Cannot edit a quotation in this status.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  const data      = parsed.data
  const qty       = data.qty       ? new Prisma.Decimal(data.qty)       : item.qty
  const unitPrice = data.unitPrice ? new Prisma.Decimal(data.unitPrice) : item.unitPrice
  const lineTotal = unitPrice.times(qty)

  await prisma.$transaction(async tx => {
    await tx.quotationItem.update({
      where: { id: itemId },
      data:  { qty, unitPrice, lineTotal },
    })
    await recalcTotals(id, tx)
  })

  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params

  const [quotation, item] = await Promise.all([
    prisma.quotation.findUnique({ where: { id }, select: { status: true, companyId: true } }),
    prisma.quotationItem.findUnique({ where: { id: itemId, quotationId: id } }),
  ])

  if (!quotation || !item) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!['draft', 'pending_review'].includes(quotation.status)) {
    return Response.json({ error: 'Cannot edit a quotation in this status.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  await prisma.$transaction(async tx => {
    await tx.quotationItem.delete({ where: { id: itemId } })
    await recalcTotals(id, tx)
  })

  return Response.json({ ok: true })
}
