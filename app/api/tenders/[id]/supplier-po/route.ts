/**
 * Supplier PO issuance (Stage 5).
 *   POST  — issue a PO to the awarded supplier (partial allowed). Enforces the
 *           balance guard (qty ≤ remaining-to-order) and uses the FROZEN
 *           awarded price (never editable). Optionally mirrors to QNE (flagged).
 *   PATCH — acknowledge / close a PO  { supplierPoId, ack?, supplierRef?, close? }
 * Purchaser / Admin / SuperAdmin. Stage = supplier_po or receiving.
 */
import { z } from 'zod'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { canActOnStage } from '@/lib/tenderAccess'
import { getRemainingByItem } from '@/lib/tenderBalance'
import { getTenderSettings } from '@/lib/tenderSettings'
import { nextSupplierPoNumber } from '@/lib/tenderRef'
import { createQnePurchaseOrder } from '@/lib/qneTender'

const ISSUABLE = ['supplier_po', 'receiving']

const PostBody = z.object({
  supplierId:       z.string().uuid(),
  deliveryDate:     z.string().datetime().optional().nullable(),
  deliveryLocation: z.string().trim().optional().nullable(),
  items: z.array(z.object({ tenderItemId: z.string().uuid(), qty: z.number().positive() })).min(1),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'supplier_po')) return Response.json({ error: 'Forbidden — purchasing stage' }, { status: 403 })

  const { id } = await params
  const parsed = PostBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      items: { include: { matchedProduct: { select: { qneItemCode: true } } } },
      vendors: { where: { supplierId: d.supplierId }, include: { supplier: { select: { name: true } } } },
    },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!ISSUABLE.includes(tender.stage)) return Response.json({ error: 'POs can only be issued after Gate 3 (Stage 5).' }, { status: 409 })
  const vendor = tender.vendors[0]
  if (!vendor) return Response.json({ error: 'That supplier is not a vendor on this tender.' }, { status: 400 })

  const itemById = new Map(tender.items.map(i => [i.id, i]))
  const remaining = await getRemainingByItem(id)

  // Validate every line: awarded to THIS supplier, within remaining balance
  for (const line of d.items) {
    const it = itemById.get(line.tenderItemId)
    if (!it) return Response.json({ error: 'Unknown item.' }, { status: 400 })
    if (it.awardedSupplierId !== d.supplierId) {
      return Response.json({ error: `"${it.name}" was not awarded to this supplier.` }, { status: 400 })
    }
    const rem = remaining.get(line.tenderItemId) ?? 0
    if (line.qty > rem + 1e-9) {
      return Response.json({ error: `Ordering ${line.qty} of "${it.name}" exceeds the remaining tender balance (${rem}).`, item: it.name, remaining: rem }, { status: 409 })
    }
  }

  const poNumber = await nextSupplierPoNumber()
  const priceValidityDate = tender.periodEnd ?? tender.submissionExpiry ?? null

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  const po = await prisma.supplierPO.create({
    data: {
      tenderId: id,
      supplierId: d.supplierId,
      poNumber,
      status: 'issued',
      deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : null,
      deliveryLocation: d.deliveryLocation ?? null,
      priceValidityDate,
      issuedById: session.userId,
      items: {
        create: d.items.map(line => ({
          tenderItemId: line.tenderItemId,
          qty: line.qty,
          unitPrice: itemById.get(line.tenderItemId)!.awardedUnitPrice ?? 0, // FROZEN awarded price
        })),
      },
    },
  })

  // Advance to receiving on first PO
  if (tender.stage === 'supplier_po') {
    await prisma.tender.update({ where: { id }, data: { stage: 'receiving' } })
  }

  // Optional QNE mirror (flag-gated, best-effort — never blocks issuance)
  let qneNote: string | null = null
  const settings = await getTenderSettings()
  if (settings.qneWritesEnabled) {
    try {
      const qneCode = await createQnePurchaseOrder({
        supplierCode: '', // TODO: requires a QNE supplier-code mapping (not stored yet)
        supplierName: vendor.supplier.name,
        referenceNo: `${tender.refNo}/${poNumber}`,
        project: tender.qneProjectCode,
        requireDate: po.deliveryDate,
        items: d.items.map(line => ({
          stock: itemById.get(line.tenderItemId)?.matchedProduct?.qneItemCode ?? itemById.get(line.tenderItemId)?.qneStockCode ?? '',
          qty: line.qty,
          unitPrice: Number(itemById.get(line.tenderItemId)!.awardedUnitPrice ?? 0),
          description: itemById.get(line.tenderItemId)?.name,
        })),
      })
      await prisma.supplierPO.update({ where: { id: po.id }, data: { qnePoCode: qneCode } })
    } catch (e) {
      qneNote = e instanceof Error ? e.message : 'QNE PO write failed'
    }
  }

  return Response.json({ id: po.id, poNumber, qneNote }, { status: 201 })
}

const PatchBody = z.object({
  supplierPoId: z.string().uuid(),
  ack:          z.boolean().optional(),
  supplierRef:  z.string().trim().optional().nullable(),
  close:        z.boolean().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canActOnStage(session.role, 'supplier_po')) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  const d = parsed.data

  const po = await prisma.supplierPO.findFirst({ where: { id: d.supplierPoId, tenderId: id }, select: { id: true } })
  if (!po) return Response.json({ error: 'PO not found on this tender' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (d.ack) { data.status = 'acknowledged'; data.ackDate = new Date() }
  if (d.supplierRef !== undefined) data.supplierRef = d.supplierRef
  if (d.close) data.status = 'closed'

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`
  await prisma.supplierPO.update({ where: { id: d.supplierPoId }, data })
  return Response.json({ ok: true })
}
