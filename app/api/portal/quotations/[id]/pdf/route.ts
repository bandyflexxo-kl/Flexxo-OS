import { getOptionalShopSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertPortalCompanyAccess } from '@/lib/authorization'
import { renderQneDocPdf, qneDocTitle, type QneDocPdfData } from '@/lib/qneDocPdf'
import { ringgitInWords } from '@/lib/numberToWords'

/**
 * QNE-style Quotation PDF for a B2B customer — same measured Tahoma layout as the
 * real Flexxo QNE printout (see lib/qneDocPdf.tsx). Rendered from the CRM
 * quotation + line items, so it works without the Radmin VPN.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOptionalShopSession()
  if (!session || session.role !== 'B2B Client') return new Response('Unauthorized', { status: 401 })

  const { id } = await params

  const q = await prisma.quotation.findUnique({
    where:   { id, status: { not: 'cart' } },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { product: { select: { qneItemCode: true } } },
      },
      company: {
        select: {
          name: true,
          addresses: {
            where: { isActive: true }, orderBy: { isDefault: 'desc' }, take: 1,
            select: { line1: true, line2: true, city: true, postcode: true, state: true },
          },
        },
      },
      createdBy: { select: { name: true } },
    },
  })

  if (!q) return new Response('Not found', { status: 404 })

  const denied = assertPortalCompanyAccess(q.companyId, session)
  if (denied) return new Response('Forbidden', { status: 403 })

  const a        = q.company.addresses[0]
  const netTotal = Number(q.totalAmount ?? 0)
  const subTotal = q.subtotal != null ? Number(q.subtotal) : netTotal
  const discount = q.discountAmount != null ? Number(q.discountAmount) : 0

  const data: QneDocPdfData = {
    docType:  'QT',
    docNo:    q.referenceNo,
    date:     new Date(q.createdAt).toLocaleDateString('en-GB'),   // DD/MM/YYYY like QNE
    agent:    q.createdBy.name,
    validity: q.expiresAt ? new Date(q.expiresAt).toLocaleDateString('en-GB') : null,
    customer: {
      name:         q.company.name,
      addressLines: [a?.line1, a?.line2, [a?.postcode, a?.city].filter(Boolean).join(' '), a?.state].filter(Boolean) as string[],
    },
    items: q.items.map(it => {
      const qty   = Number(it.qty)
      const price = Number(it.unitPrice)
      const line  = Number(it.lineTotal)
      return {
        code:        it.product?.qneItemCode ?? it.brand ?? '',
        description: it.description,
        qty,
        uom:         it.unit ?? '',
        unitPrice:   price,
        amount:      qty * price,
        netAmount:   line,
      }
    }),
    amountInWords: ringgitInWords(netTotal),
    subTotal,
    totalDiscount: discount,
    roundingAdj:   0,
    netTotal,
    currency:      q.currency,
  }

  const buf   = await renderQneDocPdf(data)
  const title = qneDocTitle(q.referenceNo, q.company.name).replace(/[^\w .-]/g, '')
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${title}.pdf"`,
      'Cache-Control':       'private, no-store',
    },
  })
}
