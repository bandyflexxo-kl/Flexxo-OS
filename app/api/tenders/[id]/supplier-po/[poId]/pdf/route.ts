/**
 * GET /api/tenders/[id]/supplier-po/[poId]/pdf — branded Purchase Order PDF.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { renderPoPdf } from '@/lib/tenderPdf'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; poId: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPrivilegedRole(session.role) && session.role !== 'Purchaser') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, poId } = await params
  const po = await prisma.supplierPO.findFirst({
    where: { id: poId, tenderId: id },
    include: {
      tender:   { select: { refNo: true } },
      supplier: { select: { name: true } },
      items:    { include: { tenderItem: { select: { name: true, unit: true } } } },
    },
  })
  if (!po) return Response.json({ error: 'Not found' }, { status: 404 })

  const pdf = await renderPoPdf({
    poNumber: po.poNumber,
    tenderRef: po.tender.refNo,
    supplierName: po.supplier.name,
    priceValidityDate: po.priceValidityDate,
    deliveryDate: po.deliveryDate,
    deliveryLocation: po.deliveryLocation,
    items: po.items.map(i => ({ item: i.tenderItem.name, unit: i.tenderItem.unit, qty: Number(i.qty), unitPrice: Number(i.unitPrice) })),
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${po.poNumber}.pdf"` },
  })
}
