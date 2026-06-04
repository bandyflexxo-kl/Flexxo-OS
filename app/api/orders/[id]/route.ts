import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess, isPrivilegedRole } from '@/lib/authorization'
import { sendOrderStatusWhatsApp } from '@/lib/wabaMessages'
import { z } from 'zod'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') return Response.json({ error: 'Forbidden' }, { status: 403 })

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

  if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(order.companyId, session)
  if (denied) return denied

  // Fetch related activities (order status changes)
  const activities = await prisma.activity.findMany({
    where:   { companyId: order.companyId, activityType: 'order_status_change' },
    orderBy: { createdAt: 'desc' },
    take:    20,
    include: { user: { select: { name: true } } },
  })

  return Response.json({
    id:               order.id,
    referenceNo:      order.referenceNo,
    status:           order.status,
    source:           order.source,
    currency:         order.currency,
    totalAmount:      order.totalAmount?.toString()  ?? null,
    customerPoNumber: order.customerPoNumber,
    qneInvoiceRef:    order.qneInvoiceRef,
    qneDoRef:         order.qneDoRef,
    deliveredAt:      order.deliveredAt?.toISOString() ?? null,
    createdAt:        order.createdAt.toISOString(),
    company:          order.company,
    quotation:        order.quotation,
    createdBy:        order.createdBy,
    items: order.items.map(i => ({
      id:          i.id,
      qty:         i.qty.toString(),
      unitPrice:   i.unitPrice.toString(),
      lineTotal:   i.lineTotal.toString(),
      productName: i.product?.name ?? null,
      qneItemCode: i.product?.qneItemCode ?? null,
    })),
    statusActivities: activities.map(a => ({
      subject:     a.subject,
      performedBy: a.user?.name ?? null,
      createdAt:   a.createdAt.toISOString(),
    })),
  })
}

const ORDER_STATUSES = ['Confirmed', 'Processing', 'Shipped', 'Delivered'] as const
type OrderStatus = (typeof ORDER_STATUSES)[number]

const UpdateSchema = z.object({
  status:           z.enum(ORDER_STATUSES).optional(),
  customerPoNumber: z.string().nullable().optional(),
  qneInvoiceRef:    z.string().nullable().optional(),
  qneDoRef:         z.string().nullable().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'B2B Client') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const order = await prisma.order.findUnique({
    where:  { id },
    select: { id: true, companyId: true, status: true, referenceNo: true },
  })
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 })

  const denied = await assertCompanyAccess(order.companyId, session)
  if (denied) return denied

  // Status changes require Manager or Admin
  if (parsed.data.status && !isPrivilegedRole(session.role)) {
    return Response.json({ error: 'Only Managers and Admins can update order status.' }, { status: 403 })
  }

  const prevStatus = order.status
  const newStatus  = parsed.data.status

  await prisma.$transaction(async tx => {
    await tx.order.update({
      where: { id },
      data:  {
        ...(newStatus !== undefined ? {
          status:      newStatus,
          deliveredAt: newStatus === 'Delivered' ? new Date() : undefined,
        } : {}),
        ...(parsed.data.customerPoNumber !== undefined ? { customerPoNumber: parsed.data.customerPoNumber ?? null } : {}),
        ...(parsed.data.qneInvoiceRef    !== undefined ? { qneInvoiceRef:    parsed.data.qneInvoiceRef    ?? null } : {}),
        ...(parsed.data.qneDoRef         !== undefined ? { qneDoRef:         parsed.data.qneDoRef         ?? null } : {}),
      },
    })

    // Log status change as Activity
    if (newStatus && newStatus !== prevStatus) {
      await tx.activity.create({
        data: {
          companyId:    order.companyId,
          activityType: 'order_status_change',
          subject:      `Order ${id.slice(0, 8)} status: ${prevStatus} → ${newStatus}`,
          body:         `Order status updated by ${session.name ?? session.email}`,
          userId:       session.userId,
        },
      })
    }
  })

  // Send WhatsApp status notification via WABA (fire-and-forget)
  if (newStatus && newStatus !== prevStatus) {
    sendOrderStatusWhatsApp({
      companyId:  order.companyId,
      orderId:    id,
      orderRef:   order.referenceNo ?? id.slice(0, 8),
      newStatus,
      userId:     session.userId,
    }).catch(() => undefined)
  }

  return Response.json({ ok: true, status: newStatus ?? prevStatus })
}
