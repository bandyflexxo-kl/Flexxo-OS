/**
 * POST /api/tenders/[id]/client-po
 * Stage 4 — log a client PO (partial allowed). Purchaser / Admin / SuperAdmin,
 * stage = 'client_po'.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'

const Body = z.object({
  poNumber:     z.string().trim().min(1),
  dateReceived: z.string().datetime().optional(),
  picName:      z.string().trim().optional().nullable(),
  picEmail:     z.string().email().optional().nullable(),
  picPhone:     z.string().trim().optional().nullable(),
  items: z.array(z.object({
    tenderItemId: z.string().uuid(),
    qtyCovered:   z.number().positive(),
    value:        z.number().nonnegative().optional(),
  })).min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'client_po')) return Response.json({ error: 'Forbidden — purchasing stage' }, { status: 403 })

  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: { items: { select: { id: true, awardedUnitPrice: true } } },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'client_po') return Response.json({ error: 'Client POs are logged during Stage 4 only.' }, { status: 409 })

  const itemPrice = new Map(tender.items.map(i => [i.id, i.awardedUnitPrice != null ? Number(i.awardedUnitPrice) : 0]))
  for (const it of d.items) {
    if (!itemPrice.has(it.tenderItemId)) return Response.json({ error: 'Unknown item in client PO.' }, { status: 400 })
  }

  // Derive line + PO value from awarded price when value not supplied
  const lines = d.items.map(it => ({
    tenderItemId: it.tenderItemId,
    qtyCovered:   it.qtyCovered,
    value:        it.value ?? it.qtyCovered * (itemPrice.get(it.tenderItemId) ?? 0),
  }))
  const poValue = lines.reduce((s, l) => s + l.value, 0)

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  const po = await prisma.clientPO.create({
    data: {
      tenderId: id,
      poNumber: d.poNumber,
      dateReceived: d.dateReceived ? new Date(d.dateReceived) : new Date(),
      value: poValue,
      picName: d.picName ?? null,
      picEmail: d.picEmail ?? null,
      picPhone: d.picPhone ?? null,
      recordedById: session.userId,
      items: { create: lines },
    },
  })

  return Response.json({ id: po.id, value: poValue }, { status: 201 })
}
