/**
 * GET  /api/tenders   — list (role-scoped) — used by client widgets if needed.
 * POST /api/tenders   — Stage 1 create. Persists Tender + items + invited
 *                       vendors, then opens Gate 1 (manager acknowledgement)
 *                       as an ApprovalRequest. The audit actor is set inside
 *                       the transaction so triggers attribute the writes.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { canCreateTender } from '@/lib/tenderAccess'
import { nextTenderRef } from '@/lib/tenderRef'

const ItemSchema = z.object({
  name:        z.string().min(1),
  unit:        z.string().optional().nullable(),
  qty:         z.number().positive(),
  targetPrice: z.number().nonnegative().optional().nullable(),
})

const CreateSchema = z.object({
  name:                 z.string().min(2, 'Tender name is required'),
  category:             z.string().optional().nullable(),
  mode:                 z.enum(['single', 'multi']).default('multi'),
  periodStart:          z.string().datetime().optional().nullable(),
  periodEnd:            z.string().datetime().optional().nullable(),
  submissionExpiry:     z.string().datetime().optional().nullable(),
  expectedClientPoDate: z.string().datetime().optional().nullable(),
  estValue:             z.number().nonnegative().optional().nullable(),
  competitorNotes:      z.string().optional().nullable(),
  internalRemarks:      z.string().optional().nullable(),
  minQuotesRequired:    z.number().int().positive().optional().nullable(),
  clientCompanyId:      z.string().uuid().optional().nullable(),
  items:                z.array(ItemSchema).min(1, 'At least one item is required'),
  vendorSupplierIds:    z.array(z.string().uuid()).optional().default([]),
})

const toDate = (s: string | null | undefined): Date | null => (s ? new Date(s) : null)

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const where =
    isPrivilegedRole(session.role) || session.role === 'Purchaser' || session.role === 'Warehouse'
      ? {}
      : { createdById: session.userId }

  const tenders = await prisma.tender.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, refNo: true, name: true, stage: true, status: true, submissionExpiry: true, estValue: true },
    take: 200,
  })
  return Response.json(tenders.map(t => ({ ...t, estValue: t.estValue?.toString() ?? null })))
}

export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateTender(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = CreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const refNo = await nextTenderRef()

  // Dedupe vendor ids
  const vendorIds = [...new Set(d.vendorSupplierIds ?? [])]

  // Sequential writes (no interactive $transaction) to match the codebase
  // pattern (companies route) — interactive transactions are unreliable on the
  // Supabase PgBouncer pooler. set_config attributes the audit actor best-effort.
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const tender = await prisma.tender.create({
    data: {
      refNo,
      name:                 d.name,
      category:             d.category ?? null,
      mode:                 d.mode,
      stage:                'creation',
      status:               'active',
      periodStart:          toDate(d.periodStart),
      periodEnd:            toDate(d.periodEnd),
      submissionExpiry:     toDate(d.submissionExpiry),
      expectedClientPoDate: toDate(d.expectedClientPoDate),
      estValue:             d.estValue ?? null,
      competitorNotes:      d.competitorNotes ?? null,
      internalRemarks:      d.internalRemarks ?? null,
      minQuotesRequired:    d.minQuotesRequired ?? null,
      clientCompanyId:      d.clientCompanyId ?? null,
      createdById:          session.userId,
      items: {
        create: d.items.map((it, i) => ({
          pos:         i + 1,
          name:        it.name,
          unit:        it.unit ?? null,
          qty:         it.qty,
          targetPrice: it.targetPrice ?? null,
        })),
      },
      vendors: {
        create: vendorIds.map(supplierId => ({ supplierId, replyStatus: 'sent' })),
      },
    },
  })

  // Gate 1 — manager must acknowledge before RFQ can be sent.
  const approval = await prisma.approvalRequest.create({
    data: {
      entityType:      'tender',
      entityId:        tender.id,
      actionRequested: 'gate1_ack',
      status:          'pending',
      requestedById:   session.userId,
      requestNotes:    `Gate 1 acknowledgement for tender ${refNo} — "${d.name}"`,
    },
  })
  await prisma.tender.update({ where: { id: tender.id }, data: { gate1ApprovalId: approval.id } })

  const tenderId = tender.id

  return Response.json({ id: tenderId, refNo }, { status: 201 })
}
