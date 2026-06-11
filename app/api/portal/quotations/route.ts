import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.customerCompanyId) {
    return Response.json({ quotations: [] })
  }

  const quotations = await prisma.quotation.findMany({
    where: {
      companyId: session.customerCompanyId,
      status:    { not: 'cart' },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id:          true,
      referenceNo: true,
      status:      true,
      totalAmount: true,
      currency:    true,
      createdAt:   true,
      sentAt:      true,
      expiresAt:   true,
      _count:      { select: { items: true } },
    },
  })

  return Response.json(quotations.map(q => ({
    ...q,
    totalAmount: q.totalAmount?.toString() ?? null,
    createdAt:   q.createdAt.toISOString(),
    sentAt:      q.sentAt?.toISOString() ?? null,
    expiresAt:   q.expiresAt?.toISOString() ?? null,
    itemCount:   q._count.items,
  })))
}
