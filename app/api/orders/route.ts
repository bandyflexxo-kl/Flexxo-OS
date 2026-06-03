import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { companyOwnerFilter } from '@/lib/authorization'

export async function GET(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (session.role === 'B2B Client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get('companyId')

  const orders = await prisma.order.findMany({
    where: {
      company: companyOwnerFilter(session),
      ...(companyId ? { companyId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      company:   { select: { id: true, name: true } },
      quotation: { select: { referenceNo: true } },
      _count:    { select: { items: true } },
    },
  })

  return Response.json(orders.map(o => ({
    id:              o.id,
    referenceNo:     o.referenceNo,
    status:          o.status,
    currency:        o.currency,
    totalAmount:     o.totalAmount?.toString()  ?? null,
    customerPoNumber: o.customerPoNumber,
    qneInvoiceRef:   o.qneInvoiceRef,
    qneDoRef:        o.qneDoRef,
    deliveredAt:     o.deliveredAt?.toISOString() ?? null,
    createdAt:       o.createdAt.toISOString(),
    company:         o.company,
    quotationRef:    o.quotation?.referenceNo ?? null,
    itemCount:       o._count.items,
  })))
}
