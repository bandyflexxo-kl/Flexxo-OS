/**
 * POST /api/tenders/[id]/grn
 * Stage 6 — record goods received against a supplier PO (3-way match).
 * Receiver (Warehouse) / Purchaser / Admin / SuperAdmin, stage = 'receiving'.
 *
 * 3-way match: cumulative received per PO line may not exceed the ordered qty
 * (over-delivery is blocked — purchasing must handle it). Short delivery is
 * allowed and leaves the line open. PO status auto-updates to
 * partially_received / received; closing the PO/tender stays manual.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'
import { getTenderSettings } from '@/lib/tenderSettings'
import { nextGrnNumber } from '@/lib/tenderRef'
import { createQneGrn } from '@/lib/qneTender'

const Body = z.object({
  supplierPoId: z.string().uuid(),
  photoUrl:     z.string().url().optional().nullable(),
  lines: z.array(z.object({
    supplierPoItemId: z.string().uuid(),
    qtyReceived:      z.number().nonnegative(),
    rejectQty:        z.number().nonnegative().optional(),
    rejectReason:     z.string().trim().optional().nullable(),
  })).min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'receiving')) return Response.json({ error: 'Forbidden — receiving stage' }, { status: 403 })

  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const tender = await prisma.tender.findUnique({ where: { id }, select: { stage: true } })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tender.stage !== 'receiving') return Response.json({ error: 'GRNs can only be recorded during receiving (Stage 6).' }, { status: 409 })

  const po = await prisma.supplierPO.findFirst({
    where: { id: d.supplierPoId, tenderId: id },
    include: { items: { include: { grnItems: { select: { qtyReceived: true } } } } },
  })
  if (!po) return Response.json({ error: 'PO not found on this tender' }, { status: 404 })
  if (po.status === 'closed') return Response.json({ error: 'This PO is closed.' }, { status: 409 })

  const poItemById = new Map(po.items.map(i => [i.id, i]))

  // 3-way match: validate cumulative received ≤ ordered
  for (const line of d.lines) {
    const pi = poItemById.get(line.supplierPoItemId)
    if (!pi) return Response.json({ error: 'GRN line does not belong to this PO.' }, { status: 400 })
    const alreadyRecv = pi.grnItems.reduce((s, g) => s + Number(g.qtyReceived), 0)
    if (alreadyRecv + line.qtyReceived > Number(pi.qty) + 1e-9) {
      return Response.json({
        error: `Over-delivery blocked: received ${alreadyRecv + line.qtyReceived} exceeds ordered ${Number(pi.qty)} on a line. Purchasing must approve over-deliveries.`,
      }, { status: 409 })
    }
  }

  const grnNumber = await nextGrnNumber()
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  const grn = await prisma.goodsReceipt.create({
    data: {
      supplierPoId: d.supplierPoId,
      grnNumber,
      receivedById: session.userId,
      photoUrl: d.photoUrl ?? null,
      items: {
        create: d.lines.map(l => ({
          supplierPoItemId: l.supplierPoItemId,
          qtyReceived: l.qtyReceived,
          rejectQty: l.rejectQty ?? 0,
          rejectReason: l.rejectReason ?? null,
        })),
      },
    },
  })

  // Recompute PO status (received when every line fully delivered)
  const fresh = await prisma.supplierPOItem.findMany({
    where: { supplierPoId: d.supplierPoId },
    include: { grnItems: { select: { qtyReceived: true } } },
  })
  const allFull = fresh.every(pi => pi.grnItems.reduce((s, g) => s + Number(g.qtyReceived), 0) >= Number(pi.qty) - 1e-9)
  const anyRecv = fresh.some(pi => pi.grnItems.length > 0)
  const newStatus = allFull ? 'received' : anyRecv ? 'partially_received' : po.status
  if (newStatus !== po.status) await prisma.supplierPO.update({ where: { id: d.supplierPoId }, data: { status: newStatus } })

  // Optional QNE GRN mirror (flag-gated, best-effort)
  let qneNote: string | null = null
  const settings = await getTenderSettings()
  if (settings.qneWritesEnabled) {
    try {
      const full = await prisma.supplierPO.findUnique({
        where: { id: d.supplierPoId },
        include: {
          supplier: { select: { name: true } },
          tender:   { select: { refNo: true, qneProjectCode: true } },
          items:    { include: { tenderItem: { include: { matchedProduct: { select: { qneItemCode: true } } } } } },
        },
      })
      const recvMap = new Map(d.lines.map(l => [l.supplierPoItemId, l.qtyReceived]))
      const qneItems = (full?.items ?? []).filter(pi => recvMap.has(pi.id)).map(pi => ({
        stock: pi.tenderItem.matchedProduct?.qneItemCode ?? pi.tenderItem.qneStockCode ?? '',
        qty: recvMap.get(pi.id)!, unitPrice: Number(pi.unitPrice), note: pi.tenderItem.name,
      }))
      const code = await createQneGrn({
        supplierCode: '', // TODO: QNE supplier-code mapping (not stored yet)
        supplierName: full!.supplier.name,
        referenceNo: `${full!.tender.refNo}/${full!.poNumber}`,
        project: full!.tender.qneProjectCode,
        items: qneItems,
      })
      await prisma.goodsReceipt.update({ where: { id: grn.id }, data: { qneGrnCode: code } })
    } catch (e) {
      qneNote = e instanceof Error ? e.message : 'QNE GRN write failed'
    }
  }

  const rejected = d.lines.some(l => (l.rejectQty ?? 0) > 0)
  return Response.json({ id: grn.id, grnNumber, poStatus: newStatus, hasRejects: rejected, qneNote }, { status: 201 })
}
