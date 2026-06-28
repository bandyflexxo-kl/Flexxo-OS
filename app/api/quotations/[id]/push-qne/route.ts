/**
 * Gated QNE write — push a CRM quotation to QNE (POST /api/Quotations), or run the
 * QuotationToInvoice shortcut. The admin clicking the button IS the approval gate
 * (CLAUDE.md). The quotation's QNE refs land in QneDocLink for the SO step to chain.
 */

import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { qneQuotationCreate, qneQuotationToInvoice } from '@/lib/qneOrderingCreate'

const Body = z.object({ shortcut: z.boolean().optional() })

/** Current QNE push status for this quotation (and its shortcut invoice, if any). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const links = await prisma.qneDocLink.findMany({
    where:  { crmId: id, docType: { in: ['quotation', 'invoice'] } },
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

  const result = parsed.data.shortcut
    ? await qneQuotationToInvoice(id, { pushedById: session.userId })
    : await qneQuotationCreate(id, { pushedById: session.userId })

  return result.ok
    ? Response.json(result)
    : Response.json({ error: result.error }, { status: 502 })
}
