/**
 * Vendor management for Stage 2 (RFQ). Only actionable while stage = 'rfq'.
 *   POST   — add vendors          { supplierIds: string[] }
 *   PATCH  — update one vendor     { vendorId, replyStatus?, quoteValidityDays?, markSent? }
 *   DELETE — remove a vendor       { vendorId }
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'

const REPLY_STATES = ['sent', 'acknowledged', 'price_received', 'no_response'] as const

async function loadEditableTender(id: string) {
  return prisma.tender.findUnique({ where: { id }, select: { id: true, stage: true } })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'rfq')) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const tender = await loadEditableTender(id)
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'rfq') return Response.json({ error: 'Vendors can only be edited during the RFQ stage.' }, { status: 409 })

  const parsed = z.object({ supplierIds: z.array(z.string().uuid()).min(1) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const existing = await prisma.tenderVendor.findMany({ where: { tenderId: id }, select: { supplierId: true } })
  const have = new Set(existing.map(e => e.supplierId))
  const toAdd = [...new Set(parsed.data.supplierIds)].filter(s => !have.has(s))

  if (toAdd.length) {
    await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
    await prisma.tenderVendor.createMany({ data: toAdd.map(supplierId => ({ tenderId: id, supplierId, replyStatus: 'sent' })) })
  }
  return Response.json({ added: toAdd.length })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'rfq')) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const tender = await loadEditableTender(id)
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'rfq') return Response.json({ error: 'Vendors can only be edited during the RFQ stage.' }, { status: 409 })

  const parsed = z.object({
    vendorId:          z.string().uuid(),
    replyStatus:       z.enum(REPLY_STATES).optional(),
    quoteValidityDays: z.number().int().positive().nullable().optional(),
    markSent:          z.boolean().optional(),
  }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const vendor = await prisma.tenderVendor.findFirst({ where: { id: d.vendorId, tenderId: id } })
  if (!vendor) return Response.json({ error: 'Vendor not found on this tender' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (d.quoteValidityDays !== undefined) data.quoteValidityDays = d.quoteValidityDays
  if (d.markSent) { data.rfqSentAt = new Date(); data.replyStatus = 'sent' }
  if (d.replyStatus) {
    data.replyStatus = d.replyStatus
    const now = new Date()
    if (d.replyStatus === 'acknowledged' && !vendor.acknowledgedAt) data.acknowledgedAt = now
    if (d.replyStatus === 'price_received') {
      data.priceReceivedAt = now
      const days = d.quoteValidityDays ?? vendor.quoteValidityDays
      if (days) data.quoteValidUntil = new Date(now.getTime() + days * 86400000)
    }
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.tenderVendor.update({ where: { id: d.vendorId }, data })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'rfq')) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const tender = await loadEditableTender(id)
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'rfq') return Response.json({ error: 'Vendors can only be edited during the RFQ stage.' }, { status: 409 })

  const parsed = z.object({ vendorId: z.string().uuid() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const vendor = await prisma.tenderVendor.findFirst({ where: { id: parsed.data.vendorId, tenderId: id }, select: { id: true } })
  if (!vendor) return Response.json({ error: 'Vendor not found on this tender' }, { status: 404 })

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.tenderVendorQuote.deleteMany({ where: { tenderVendorId: vendor.id } })
  await prisma.tenderVendor.delete({ where: { id: vendor.id } })
  return Response.json({ ok: true })
}
