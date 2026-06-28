import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'
import OrderDetail from '@/components/orders/OrderDetail'
import type { OrderDetailProps } from '@/components/orders/OrderDetail'
import QnePushPanel from '@/components/qne/QnePushPanel'

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
      invoice: {
        select: {
          id: true, invoiceNo: true, issuedAt: true,
          qnePushStatus: true, totalAmount: true,
        },
      },
      warehouseTask: {
        select: {
          id: true, status: true, completedAt: true,
          completedBy: { select: { name: true } },
        },
      },
      deliveryBooking: {
        select: {
          id: true, bookingStatus: true, serviceType: true,
          quotedPriceMyr: true, shareLink: true, driverName: true,
          driverPhone: true, plateNumber: true, bookedAt: true, retryCount: true,
        },
      },
    },
  })

  if (!order) notFound()

  const denied = await assertCompanyAccess(order.companyId, session)
  if (denied) redirect('/orders')

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
    invoice: order.invoice ? {
      id:            order.invoice.id,
      invoiceNo:     order.invoice.invoiceNo,
      issuedAt:      order.invoice.issuedAt.toISOString(),
      qnePushStatus: order.invoice.qnePushStatus,
      totalAmount:   order.invoice.totalAmount.toString(),
    } : null,
    warehouseTask: order.warehouseTask ? {
      id:          order.warehouseTask.id,
      status:      order.warehouseTask.status,
      completedAt: order.warehouseTask.completedAt?.toISOString() ?? null,
      completedBy: order.warehouseTask.completedBy?.name ?? null,
    } : null,
    deliveryBooking: order.deliveryBooking ? {
      id:             order.deliveryBooking.id,
      bookingStatus:  order.deliveryBooking.bookingStatus,
      serviceType:    order.deliveryBooking.serviceType,
      quotedPriceMyr: order.deliveryBooking.quotedPriceMyr?.toString() ?? null,
      shareLink:      order.deliveryBooking.shareLink,
      driverName:     order.deliveryBooking.driverName,
      driverPhone:    order.deliveryBooking.driverPhone,
      plateNumber:    order.deliveryBooking.plateNumber,
      bookedAt:       order.deliveryBooking.bookedAt?.toISOString() ?? null,
      retryCount:     order.deliveryBooking.retryCount,
    } : null,
  }

  return (
    <div>
      <Topbar title={order.referenceNo ?? 'Order Detail'} />
      <div className="p-6 max-w-4xl">
        <Link href="/orders" className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-5">
          ← All Orders
        </Link>
        <OrderDetail initial={initial} />
        {['Admin', 'Director'].includes(session.role) && (
          <div className="mt-6">
            <QnePushPanel mode="order" id={order.id} />
          </div>
        )}
      </div>
    </div>
  )
}
