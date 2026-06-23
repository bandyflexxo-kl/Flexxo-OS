import { redirect }           from 'next/navigation'
import { verifySession }       from '@/lib/session'
import { prisma }              from '@/lib/prisma'
import { companyOwnerFilter }  from '@/lib/authorization'
import Topbar                  from '@/components/layout/Topbar'
import NewQuotationButton      from '@/components/quotations/NewQuotationButton'
import QuotationsTable         from '@/components/quotations/QuotationsTable'

export default async function QuotationsPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const ownerFilter = companyOwnerFilter(session)

  const quotations = await prisma.quotation.findMany({
    where: {
      status:     { not: 'cart' },
      isArchived: false,
      company:    ownerFilter,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      company:   { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count:    { select: { items: true } },
    },
    take: 200,
  })

  const pendingCount  = quotations.filter(q => q.status === 'pending_review').length

  // Serialize Prisma Decimal → string for client component
  const rows = quotations.map(q => ({
    id:          q.id,
    referenceNo: q.referenceNo,
    status:      q.status,
    totalAmount: q.totalAmount?.toString() ?? null,
    createdAt:   q.createdAt.toISOString(),
    company:     q.company,
    createdBy:   q.createdBy,
    _count:      q._count,
  }))

  return (
    <div>
      <Topbar title="Quotations" actions={<NewQuotationButton />} />
      <div className="p-6 space-y-5">

        {/* Stats row */}
        <div className="flex flex-wrap gap-3">
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-gray-900">{quotations.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total</p>
          </div>
          {pendingCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
              <p className="text-2xl font-bold text-yellow-700">{pendingCount}</p>
              <p className="text-xs text-yellow-600 mt-0.5">Pending Review</p>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-purple-700">{quotations.filter(q => q.status === 'sent').length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Sent</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-green-700">{quotations.filter(q => q.status === 'accepted').length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Accepted</p>
          </div>
        </div>

        {/* Table */}
        {quotations.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center space-y-3">
            <p className="text-4xl">📄</p>
            <p className="text-gray-500 text-sm">No quotations yet.</p>
            <p className="text-xs text-gray-400">Quotations are created when customers check out from the portal,<br/>or you can start one manually from a company page.</p>
          </div>
        ) : (
          <QuotationsTable quotations={rows} role={session.role} />
        )}
      </div>
    </div>
  )
}
