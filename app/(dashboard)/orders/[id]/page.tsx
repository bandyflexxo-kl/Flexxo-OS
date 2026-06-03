import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'
import OrderDetail from '@/components/orders/OrderDetail'
import type { OrderDetailProps } from '@/components/orders/OrderDetail'

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  if (session.role === 'B2B Client') redirect('/')

  const { id } = await params

  const order = await prisma.order.findUnique({
    where:   { id },
    include: {
      company:   { select: { id: true, name: true } },
      quotation: { select: { id: true, referenceNo: true } },
      createdBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { name: true, qneItemCode: true } },
        },
      },
    },
  })

  if (!order) notFound()

  const denied = await assertCompanyAccess(order.companyId, session)
  if (denied) redirect('/orders')

  // Fetch status change activities for this order
  const statusActivities = await prisma.activity.findMany({
    where:   { companyId: order.companyId, activityType: 'order_status_change' },
    orderBy: { createdAt: 'desc' },
    take:    20,
    include: { user: { select: { name: true } } },
  })

  const initial: OrderDetailProps = {
    id:               order.id,
    referenceNo:      order.referenceNo,
    status:           order.status,
    source:           order.source,
    currency:         order.currency,
    totalAmount:      order.totalAmount?.toString()   ?? null,
    customerPoNumber: order.customerPoNumber,
    qneInvoiceRef:    order.qneInvoiceRef,
    qneDoRef:         order.qneDoRef,
    deliveredAt:      order.deliveredAt?.toISOString() ?? null,
    createdAt:        order.createdAt.toISOString(),
    company:          order.company,
    quotation:        order.quotation,
    createdBy:        order.createdBy,
    userRole:         session.role,
    items: order.items.map(i => ({
      id:          i.id,
      qty:         i.qty.toString(),
      unitPrice:   i.unitPrice.toString(),
      lineTotal:   i.lineTotal.toString(),
      productName: i.product?.name ?? null,
      qneItemCode: i.product?.qneItemCode ?? null,
    })),
    statusActivities: statusActivities.map(a => ({
      subject:     a.subject,
      performedBy: a.user?.name ?? null,
      createdAt:   a.createdAt.toISOString(),
    })),
  }

  return (
    <div>
      <Topbar title={order.referenceNo ?? 'Order Detail'} />
      <div className="p-6 max-w-4xl">
        <Link href="/orders" className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-5">
          ← All Orders
        </Link>
        <OrderDetail initial={initial} />
      </div>
    </div>
  )
}
