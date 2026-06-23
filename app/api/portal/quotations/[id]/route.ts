import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where: { id, status: { not: 'cart' } },
    include: {
      items: {
        include: { product: { select: { id: true, name: true, brand: true, unit: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      company:   { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  })

  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = assertPortalCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  return Response.json({
    id:              quotation.id,
    referenceNo:     quotation.referenceNo,
    status:          quotation.status,
    currency:        quotation.currency,
    subtotal:        quotation.subtotal?.toString() ?? null,
    totalAmount:     quotation.totalAmount?.toString() ?? null,
    poNumber:        quotation.poNumber ?? null,
    costCentre:      quotation.costCentre ?? null,
    termsConditions: quotation.termsConditions,
    sentAt:          quotation.sentAt?.toISOString() ?? null,
    expiresAt:       quotation.expiresAt?.toISOString() ?? null,
    createdAt:       quotation.createdAt.toISOString(),
    company:         quotation.company,
    createdBy:       quotation.createdBy,
    items: quotation.items.map(item => ({
      id:          item.id,
      description: item.description,
      brand:       item.brand,
      unit:        item.unit,
      qty:         item.qty.toString(),
      unitPrice:   item.unitPrice.toString(),
      lineTotal:   item.lineTotal.toString(),
      product:     item.product,
    })),
  })
}
