import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cart = await prisma.quotation.findFirst({
    where: {
      status:      'cart',
      createdById: session.userId,
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, brand: true, unit: true, googleDrivePhotoId: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!cart) return Response.json({ items: [], subtotal: '0', totalAmount: '0' })

  return Response.json({
    quotationId: cart.id,
    items: cart.items.map(item => ({
      id:          item.id,
      productId:   item.productId,
      product:     item.product,
      description: item.description,
      qty:         item.qty.toString(),
      unitPrice:   item.unitPrice.toString(),
      lineTotal:   item.lineTotal.toString(),
    })),
    subtotal:    (cart.subtotal ?? 0).toString(),
    totalAmount: (cart.totalAmount ?? 0).toString(),
  })
}
