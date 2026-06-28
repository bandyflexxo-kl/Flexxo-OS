/**
 * Gated QNE write — push an order's QNE document for a given chain stage:
 *   sales_order    → POST /api/SalesOrders     (transferFrom the pushed quotation)
 *   delivery_order → POST /api/DeliveryOrders   (transferFrom the pushed SO)
 *   invoice        → POST /api/SalesInvoices     (transferFrom the pushed DO)
 *
 * The admin clicking the button IS the approval gate (CLAUDE.md — SalesOrder is
 * single approval as of 28 Jun 2026). Each stage stores its QneDocLink + lineMap
 * so the next stage can chain.
 */

import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import {
  qneSalesOrderCreate,
  qneDeliveryOrderCreate,
  qneInvoiceCreate,
} from '@/lib/qneOrderingCreate'

const Body = z.object({ stage: z.enum(['sales_order', 'delivery_order', 'invoice']) })

/** Current QNE push status for this order's three chain stages. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const links = await prisma.qneDocLink.findMany({
    where:  { crmId: id, docType: { in: ['sales_order', 'delivery_order', 'invoice'] } },
    select: { docType: true, qneCode: true, status: true, error: true },
  })
  return Response.json({ links })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const run = {
    sales_order:    qneSalesOrderCreate,
    delivery_order: qneDeliveryOrderCreate,
    invoice:        qneInvoiceCreate,
  }[parsed.data.stage]

  const result = await run(id, { pushedById: session.userId })

  return result.ok
    ? Response.json(result)
    : Response.json({ error: result.error }, { status: 502 })
}
