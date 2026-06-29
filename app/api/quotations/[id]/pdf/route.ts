import { verifySession } from '@/lib/session'
import { prisma }        from '@/lib/prisma'
import { renderQneDocPdf, qneDocTitle, type QneDocPdfData } from '@/lib/qneDocPdf'

/**
 * Quotation as a QNE-style PDF. Uses the real QNE document code (e.g. "QT KL2606/0079")
 * when the quotation has been pushed to QNE, otherwise the CRM reference. Internal
 * roles only — customer delivery happens via the quotation email (separate wiring).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director', 'Manager', 'SuperAdmin', 'Salesperson'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const q = await prisma.quotation.findUnique({
    where: { id },
    select: {
      referenceNo: true, currency: true, subtotal: true, taxAmount: true, totalAmount: true, createdAt: true,
      company: {
        select: {
          name: true,
          addresses: { where: { isActive: true }, orderBy: { isDefault: 'desc' }, take: 1,
            select: { line1: true, line2: true, city: true, postcode: true, state: true } },
        },
      },
      contact:   { select: { name: true, phone: true } },
      createdBy: { select: { name: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        select: { description: true, unit: true, qty: true, unitPrice: true, lineTotal: true,
          product: { select: { qneItemCode: true } } },
      },
    },
  })
  if (!q) return Response.json({ error: 'Quotation not found' }, { status: 404 })

  const link = await prisma.qneDocLink.findFirst({
    where:  { docType: 'quotation', crmId: id },
    select: { qneCode: true },
  }).catch(() => null)
  const code = link?.qneCode ?? q.referenceNo

  const a = q.company.addresses[0]
  const data: QneDocPdfData = {
    docType:  'QT',
    code,
    date:     q.createdAt,
    customer: {
      name:    q.company.name,
      address: [a?.line1, a?.line2, a?.city, a?.postcode, a?.state].filter(Boolean).join(', ') || null,
      contact: q.contact?.name ?? null,
      phone:   q.contact?.phone ?? null,
    },
    items: q.items.map((it, i) => ({
      pos: i + 1,
      code: it.product?.qneItemCode ?? null,
      name: it.description,
      unit: it.unit,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      amount: Number(it.lineTotal),
    })),
    subtotal:    q.subtotal != null ? Number(q.subtotal) : null,
    tax:         q.taxAmount != null ? Number(q.taxAmount) : null,
    total:       q.totalAmount != null ? Number(q.totalAmount) : null,
    currency:    q.currency,
    salesPerson: q.createdBy?.name ?? null,
  }

  const buf   = await renderQneDocPdf(data)
  const title = qneDocTitle(code, q.company.name).replace(/[^\w .-]/g, '')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${title}.pdf"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
