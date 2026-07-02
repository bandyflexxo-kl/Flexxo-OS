import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { renderQneDocPdf, qneDocTitle, type QneDocPdfData } from '@/lib/qneDocPdf'

/**
 * QNE-style invoice PDF for a B2B customer, rendered from the invoice + line items
 * already synced into our DB (qne_invoices / qne_invoice_items) — so it works
 * without the Radmin VPN and matches the Flexxo QNE printout layout.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.customerCompanyId) return Response.json({ error: 'No company linked.' }, { status: 400 })

  const { id } = await params
  const inv = await prisma.qneInvoice.findFirst({
    where:  { id, companyId: session.customerCompanyId },   // scoped to the logged-in company
    select: {
      docNo: true, docDate: true, totalAmount: true, customerCode: true,
      company: {
        select: {
          name: true,
          addresses: { where: { isActive: true }, orderBy: { isDefault: 'desc' }, take: 1,
            select: { line1: true, line2: true, city: true, postcode: true, state: true } },
        },
      },
      items: { select: { stockCode: true, description: true, qty: true, unitPrice: true, product: { select: { unit: true } } } },
    },
  })
  if (!inv) return Response.json({ error: 'Invoice not found' }, { status: 404 })

  const a = inv.company?.addresses[0]
  const data: QneDocPdfData = {
    docType: 'INV',
    docNo:   inv.docNo,
    date:    new Date(inv.docDate).toLocaleDateString('en-GB'),   // DD/MM/YYYY like QNE
    customerCode: inv.customerCode,
    customer: {
      name:         inv.company?.name ?? 'Customer',
      addressLines: [a?.line1, a?.line2, [a?.postcode, a?.city].filter(Boolean).join(' '), a?.state].filter(Boolean) as string[],
    },
    items: inv.items.map(it => {
      const qty = Number(it.qty), price = Number(it.unitPrice)
      return { code: it.stockCode ?? '', description: it.description, qty, uom: it.product?.unit ?? '', unitPrice: price, amount: qty * price, netAmount: qty * price }
    }),
    subTotal: Number(inv.totalAmount),
    netTotal: Number(inv.totalAmount),
    currency: 'MYR',
  }

  const buf   = await renderQneDocPdf(data)
  const title = qneDocTitle(inv.docNo, inv.company?.name ?? '').replace(/[^\w .-]/g, '')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${title}.pdf"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
