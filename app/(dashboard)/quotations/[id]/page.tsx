import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import Topbar from '@/components/layout/Topbar'
import QuotationBuilder from '@/components/quotations/QuotationBuilder'
import type { QuotationBuilderProps } from '@/components/quotations/QuotationBuilder'

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const { id } = await params

  const quotation = await prisma.quotation.findUnique({
    where:   { id },
    include: {
      company:   { select: { id: true, name: true } },
      contact:   { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, brand: true, unit: true, qneItemCode: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
      statusHistory: { orderBy: { changedAt: 'asc' } },
    },
  })

  if (!quotation || quotation.status === 'cart') notFound()

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) redirect('/quotations')

  const initial: QuotationBuilderProps = {
    id:              quotation.id,
    referenceNo:     quotation.referenceNo,
    status:          quotation.status,
    currency:        quotation.currency,
    subtotal:        quotation.subtotal?.toString()     ?? null,
    totalAmount:     quotation.totalAmount?.toString()  ?? null,
    termsConditions: quotation.termsConditions,
    internalNotes:   quotation.internalNotes,
    expiresAt:       quotation.expiresAt?.toISOString() ?? null,
    createdAt:       quotation.createdAt.toISOString(),
    sentAt:          quotation.sentAt?.toISOString()    ?? null,
    company:         quotation.company,
    contact:         quotation.contact,
    createdBy:       quotation.createdBy,
    items: quotation.items.map(i => ({
      id:          i.id,
      description: i.description,
      brand:       i.brand,
      unit:        i.unit,
      qty:         i.qty.toString(),
      unitCost:    i.unitCost?.toString()  ?? null,
      unitPrice:   i.unitPrice.toString(),
      marginPct:   i.marginPct?.toString() ?? null,
      lineTotal:   i.lineTotal.toString(),
      sortOrder:   i.sortOrder,
      product:     i.product,
    })),
    statusHistory: quotation.statusHistory.map(h => ({
      fromStatus: h.fromStatus,
      toStatus:   h.toStatus,
      notes:      h.notes,
      changedAt:  h.changedAt.toISOString(),
    })),
  }

  return (
    <div>
      <Topbar title={quotation.referenceNo} />
      <div className="p-6 max-w-5xl">
        <Link
          href="/quotations"
          className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-5"
        >
          ← All Quotations
        </Link>
        <QuotationBuilder initial={initial} />
      </div>
    </div>
  )
}
