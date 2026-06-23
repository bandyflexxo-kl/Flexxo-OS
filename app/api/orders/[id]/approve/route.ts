import { verifySession }      from '@/lib/session'
import { prisma }              from '@/lib/prisma'
import { isPrivilegedRole }    from '@/lib/authorization'
import { sendPushToUser }      from '@/lib/webpush'
import { notifyByRole, notifyUser, esc } from '@/lib/telegramBot'
import { sendOrderStatusWhatsApp }       from '@/lib/wabaMessages'
import { z }                   from 'zod'

const Schema = z.object({
  creditOverrideConfirmed: z.boolean().optional(),
  notes:                   z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session)                          return Response.json({ error: 'Unauthorized' },  { status: 401 })
  if (!isPrivilegedRole(session.role))   return Response.json({ error: 'Admin or Manager required' }, { status: 403 })

  const { id }   = await params
  const body     = await request.json() as unknown
  const parsed   = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const order = await prisma.order.findUnique({
    where:   { id },
    include: {
      company:   { select: { id: true, name: true } },
      items:     { include: { product: { select: { name: true } } } },
      quotation: { select: { createdById: true } },
    },
  })

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'Confirmed') {
    return Response.json({ error: `Order is ${order.status}, not Confirmed.` }, { status: 409 })
  }

  // ── Generate invoice number ───────────────────────────────────────────────
  const year       = new Date().getFullYear()
  const invCount   = await prisma.invoice.count()
  const invoiceNo  = `INV-${year}-${String(invCount + 1).padStart(4, '0')}`

  // ── Transaction: create Invoice + WarehouseTask, update Order status ──────
  const [invoice, warehouseTask] = await prisma.$transaction(async tx => {
    const inv = await tx.invoice.create({
      data: {
        orderId:      id,
        companyId:    order.companyId,
        invoiceNo,
        currency:     order.currency,
        totalAmount:  order.totalAmount ?? 0,
        issuedById:   session.userId,
        notes:        parsed.data.notes ?? null,
      },
    })

    const task = await tx.warehouseTask.create({
      data: { orderId: id, status: 'pending' },
    })

    await tx.order.update({
      where: { id },
      data:  { status: 'Approved' },
    })

    await tx.activity.create({
      data: {
        companyId:    order.companyId,
        activityType: 'order_status_change',
        subject:      `Order ${order.referenceNo ?? id} approved — ${invoiceNo} issued`,
        body:         `Approved by ${session.name}. Warehouse task created.`,
        userId:       session.userId,
      },
    })

    // ── QNE Simulation Layer: stage the invoice for manual entry later ───
    await tx.qnePendingAction.create({
      data: {
        actionType:   'invoice',
        referenceNo:  invoiceNo,
        originalDate: new Date(),           // preserve actual creation date
        payload:      {
          invoiceNo,
          orderId:      id,
          orderRef:     order.referenceNo ?? id,
          companyId:    order.companyId,
          companyName:  order.company.name,
          currency:     order.currency,
          totalAmount:  order.totalAmount?.toString() ?? '0',
          issuedBy:     session.name,
        },
        status:       'pending',
        notes:        `Auto-staged when order ${order.referenceNo ?? id} was approved in CRM.`,
      },
    })

    return [inv, task]
  })

  const orderRef    = order.referenceNo ?? id
  const companyName = order.company.name
  const itemCount   = order.items.length
  const salespersonId = order.quotation?.createdById ?? null

  // ── Push + Telegram: notify warehouse workers (fire-and-forget) ───────────
  const warehouseUsers = await prisma.userRole.findMany({
    where:   { role: { name: 'Warehouse' }, revokedAt: null },
    include: { user: { select: { id: true } } },
  })
  for (const wu of warehouseUsers) {
    sendPushToUser(wu.user.id, {
      title: '📦 New Picking Task',
      body:  `${orderRef} — ${companyName} · ${itemCount} item${itemCount !== 1 ? 's' : ''}`,
      url:   '/warehouse',
    }).catch(() => undefined)
  }
  notifyByRole(
    ['Warehouse'],
    `📦 <b>New Picking Task</b>\n\n` +
    `Order: <b>${esc(orderRef)}</b>\n` +
    `Client: <b>${esc(companyName)}</b>\n` +
    `Items: ${itemCount}\n` +
    `Invoice: <b>${esc(invoiceNo)}</b>\n\n` +
    `Go to <b>Flexxo Warehouse</b> to start picking.`,
  ).catch(() => undefined)

  // ── Telegram: notify salesperson (fire-and-forget) ────────────────────────
  if (salespersonId) {
    notifyUser(
      salespersonId,
      `✅ <b>${esc(orderRef)}</b> approved!\n\n` +
      `Invoice <b>${esc(invoiceNo)}</b> issued.\n` +
      `Warehouse picking task created for <b>${esc(companyName)}</b>.`,
    ).catch(() => undefined)
  }

  // ── WABA: notify customer (fire-and-forget) ───────────────────────────────
  sendOrderStatusWhatsApp({
    companyId: order.companyId,
    orderId:   id,
    orderRef,
    newStatus: 'Approved',
    userId:    session.userId,
  }).catch(() => undefined)

  return Response.json({ ok: true, invoiceId: invoice.id, invoiceNo, warehouseTaskId: warehouseTask.id })
}
