import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'
import { z } from 'zod'

const AmendSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().uuid(),
    qty:    z.number().int().min(0),
  })).min(1),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:   { id },
    include: { items: true },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = assertPortalCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  if (quotation.status !== 'sent') {
    return Response.json({ error: 'Only sent quotations can be amended' }, { status: 400 })
  }
  if (quotation.clientAmended) {
    return Response.json({ error: 'This quotation has already been amended once' }, { status: 400 })
  }

  const body = await request.json() as unknown
  const parsed = AmendSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 })
  }

  const { items: changes } = parsed.data

  // Verify all itemIds belong to this quotation
  const itemIds = quotation.items.map(i => i.id)
  const unknown = changes.find(c => !itemIds.includes(c.itemId))
  if (unknown) {
    return Response.json({ error: 'Item not found in this quotation' }, { status: 400 })
  }

  // Must leave at least 1 item
  const removals    = changes.filter(c => c.qty === 0).map(c => c.itemId)
  const remainCount = itemIds.length - removals.length
  if (remainCount < 1) {
    return Response.json({ error: 'Cannot remove all items from a quotation' }, { status: 400 })
  }

  // Apply changes in a transaction
  await prisma.$transaction(async tx => {
    for (const change of changes) {
      const existing = quotation.items.find(i => i.id === change.itemId)!
      if (change.qty === 0) {
        await tx.quotationItem.delete({ where: { id: change.itemId } })
      } else {
        const newLineTotal = Number(existing.unitPrice) * change.qty
        await tx.quotationItem.update({
          where: { id: change.itemId },
          data: {
            qty:       change.qty,
            lineTotal: newLineTotal,
          },
        })
      }
    }

    // Recalculate total from remaining items
    const remaining = await tx.quotationItem.findMany({ where: { quotationId: id } })
    const newTotal  = remaining.reduce((sum, i) => sum + Number(i.lineTotal), 0)

    await tx.quotation.update({
      where: { id },
      data: {
        subtotal:        newTotal,
        totalAmount:     newTotal,
        clientAmended:   true,
        clientAmendedAt: new Date(),
      },
    })
  })

  return Response.json({ ok: true })
}
