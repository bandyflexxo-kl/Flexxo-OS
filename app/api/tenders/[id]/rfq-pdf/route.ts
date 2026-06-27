/**
 * GET /api/tenders/[id]/rfq-pdf?supplierId=<id>
 * Branded RFQ PDF for one vendor. Access: tender roles who can see the tender.
 */
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { renderRfqPdf } from '@/lib/tenderPdf'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  const supplierId = url.searchParams.get('supplierId')
  if (!supplierId) return Response.json({ error: 'supplierId required' }, { status: 400 })

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      items:   { orderBy: { pos: 'asc' } },
      vendors: { where: { supplierId }, include: { supplier: { select: { name: true } } } },
    },
  })
  if (!tender) return Response.json({ error: 'Not found' }, { status: 404 })

  const allowed =
    isPrivilegedRole(session.role) || session.role === 'Purchaser' ||
    session.role === 'Warehouse' || tender.createdById === session.userId
  if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const vendor = tender.vendors[0]
  if (!vendor) return Response.json({ error: 'Supplier is not an invited vendor on this tender' }, { status: 404 })

  const pdf = await renderRfqPdf({
    refNo:             tender.refNo,
    tenderName:        tender.name,
    submissionExpiry:  tender.submissionExpiry,
    periodEnd:         tender.periodEnd,
    supplierName:      vendor.supplier.name,
    quoteValidityDays: vendor.quoteValidityDays,
    items:             tender.items.map(it => ({ pos: it.pos, name: it.name, unit: it.unit, qty: Number(it.qty) })),
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${tender.refNo}-RFQ-${vendor.supplier.name.replace(/[^a-z0-9]+/gi, '_')}.pdf"`,
    },
  })
}
