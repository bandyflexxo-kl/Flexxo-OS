import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'

const UpdateSchema = z.object({ qty: z.number().int().positive() })

async function recalcCart(cartId: string) {
  const items    = await prisma.quotationItem.findMany({ where: { quotationId: cartId } })
  const subtotal = items.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0))
  await prisma.quotation.update({
    where: { id: cartId },
    data:  { subtotal, totalAmount: subtotal },
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId } = await params
  const body       = await request.json() as unknown
  const parsed     = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid qty' }, { status: 400 })

  const item = await prisma.quotationItem.findUnique({
    where:   { id: itemId },
    include: { quotation: { select: { status: true, createdById: true, id: true } } },
  })

  if (!item || item.quotation.status !== 'cart' || item.quotation.createdById !== session.userId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const qty       = new Prisma.Decimal(parsed.data.qty)
  const lineTotal = item.unitPrice.times(qty)

  await prisma.quotationItem.update({
    where: { id: itemId },
    data:  { qty, lineTotal },
  })

  await recalcCart(item.quotation.id)
  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId } = await params

  const item = await prisma.quotationItem.findUnique({
    where:   { id: itemId },
    include: { quotation: { select: { status: true, createdById: true, id: true } } },
  })

  if (!item || item.quotation.status !== 'cart' || item.quotation.createdById !== session.userId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.quotationItem.delete({ where: { id: itemId } })
  await recalcCart(item.quotation.id)
  return Response.json({ ok: true })
}
