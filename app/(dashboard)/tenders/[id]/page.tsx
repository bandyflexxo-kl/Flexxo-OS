import { redirect, notFound } from 'next/navigation'
import Link                from 'next/link'
import { verifySession }   from '@/lib/session'
import { prisma }          from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { canManageGate, canActOnStage, STAGE_LABELS, type TenderStage } from '@/lib/tenderAccess'
import { getSupplierScores } from '@/lib/supplierPerformance'
import Topbar              from '@/components/layout/Topbar'
import Gate1Button         from '@/components/tenders/Gate1Button'
import TenderRfqPanel, { type PanelVendor } from '@/components/tenders/TenderRfqPanel'

export const dynamic = 'force-dynamic'

const STAGE_TONE: Record<string, string> = {
  creation: 'bg-gray-100 text-gray-700', rfq: 'bg-blue-50 text-blue-700',
  evaluation: 'bg-amber-50 text-amber-700', client_po: 'bg-indigo-50 text-indigo-700',
  supplier_po: 'bg-violet-50 text-violet-700', receiving: 'bg-cyan-50 text-cyan-700',
  closed: 'bg-green-50 text-green-700',
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  const { id } = await params

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      createdBy:     { select: { name: true } },
      clientCompany: { select: { id: true, name: true } },
      items:         { orderBy: { pos: 'asc' } },
      vendors:       { include: { supplier: { select: { name: true } } } },
    },
  })
  if (!tender) notFound()

  // Sales Exec sees own; privileged/Purchaser/Warehouse see all.
  const allowed =
    isPrivilegedRole(session.role) || session.role === 'Purchaser' ||
    session.role === 'Warehouse' || tender.createdById === session.userId
  if (!allowed) redirect('/tenders')

  const awaitingGate1 = tender.stage === 'creation'
  const canAck = awaitingGate1 && canManageGate(session.role)

  // Stage 2 (RFQ) interactive panel data
  const showRfq = tender.stage === 'rfq'
  let rfqVendors: PanelVendor[] = []
  let supplierOpts: { id: string; name: string; stars: number; invited: number }[] = []
  if (showRfq) {
    const allSuppliers = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    const scores = await getSupplierScores(allSuppliers.map(s => s.id))
    rfqVendors = tender.vendors.map(v => {
      const s = scores.get(v.supplierId)
      return {
        id: v.id, supplierId: v.supplierId, supplierName: v.supplier.name,
        replyStatus: v.replyStatus, quoteValidityDays: v.quoteValidityDays,
        rfqSentAt: v.rfqSentAt?.toISOString() ?? null,
        stars: s?.stars ?? 0, avgReplyHours: s?.avgReplyHours ?? null, won: s?.won ?? 0,
      }
    })
    supplierOpts = allSuppliers.map(s => ({ id: s.id, name: s.name, stars: scores.get(s.id)?.stars ?? 0, invited: scores.get(s.id)?.invited ?? 0 }))
  }

  return (
    <div>
      <Topbar title={tender.refNo} />
      <div className="p-6 space-y-5 max-w-4xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{tender.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_TONE[tender.stage]}`}>
                {STAGE_LABELS[tender.stage as TenderStage] ?? tender.stage}
              </span>
              {tender.status !== 'active' && <span className="text-xs text-gray-500">· {tender.status}</span>}
              {tender.clientCompany && (
                <Link href={`/companies/${tender.clientCompany.id}`} className="text-xs text-blue-600 hover:underline">
                  {tender.clientCompany.name}
                </Link>
              )}
            </div>
          </div>
          <a
            href={`/api/tenders/${tender.id}/schedule`}
            className="shrink-0 inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700 px-3 py-2 rounded-lg transition-colors"
          >
            ⬇ Item schedule (.xlsx)
          </a>
        </div>

        {/* Gate 1 banner */}
        {awaitingGate1 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-yellow-800">Awaiting Gate 1 acknowledgement</p>
              <p className="text-xs text-yellow-700 mt-0.5">The Sales Manager must acknowledge this tender before the RFQ can be sent.</p>
            </div>
            {canAck
              ? <Gate1Button tenderId={tender.id} />
              : <span className="text-xs text-yellow-600 italic shrink-0">Pending Sales Manager</span>}
          </div>
        )}

        {/* Details */}
        <section className="bg-white border border-gray-200 rounded-xl p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {[
            ['Category', tender.category ?? '—'],
            ['Mode', tender.mode === 'single' ? 'Single supplier' : 'Multi-supplier'],
            ['Est. value', tender.estValue != null ? `RM ${Number(tender.estValue).toLocaleString('en-MY')}` : '—'],
            ['Period', `${fmtDate(tender.periodStart)} → ${fmtDate(tender.periodEnd)}`],
            ['Submission expiry', fmtDate(tender.submissionExpiry)],
            ['Expected client PO', fmtDate(tender.expectedClientPoDate)],
            ['Min. quotes', tender.minQuotesRequired != null ? String(tender.minQuotesRequired) : '—'],
            ['Created by', tender.createdBy.name],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-gray-400">{k}</p>
              <p className="text-gray-900 mt-0.5">{v}</p>
            </div>
          ))}
          {tender.internalRemarks && (
            <div className="col-span-2 sm:col-span-3">
              <p className="text-xs text-gray-400">Internal remarks</p>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{tender.internalRemarks}</p>
            </div>
          )}
        </section>

        {/* Items */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Item schedule ({tender.items.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 w-10">#</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 w-20">Unit</th>
                <th className="px-4 py-2 w-24">Qty</th>
                <th className="px-4 py-2 w-32">Target price</th>
              </tr>
            </thead>
            <tbody>
              {tender.items.map(it => (
                <tr key={it.id} className="border-b border-gray-50">
                  <td className="px-4 py-2 text-gray-400">{it.pos}</td>
                  <td className="px-4 py-2 text-gray-900">{it.name}</td>
                  <td className="px-4 py-2 text-gray-600">{it.unit ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{Number(it.qty)}</td>
                  <td className="px-4 py-2 text-gray-600">{it.targetPrice != null ? `RM ${Number(it.targetPrice)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Vendors — interactive RFQ panel at Stage 2, static list otherwise */}
        {showRfq ? (
          <TenderRfqPanel
            tenderId={tender.id}
            vendors={rfqVendors}
            allSuppliers={supplierOpts}
            canEdit={canActOnStage(session.role, 'rfq')}
            canGate={canManageGate(session.role)}
            minQuotesRequired={tender.minQuotesRequired}
          />
        ) : (
          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Invited vendors ({tender.vendors.length})</h2>
            {tender.vendors.length === 0 ? (
              <p className="text-sm text-gray-400">No vendors invited yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tender.vendors.map(v => (
                  <span key={v.id} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-700">
                    {v.supplier.name}
                    <span className="text-gray-400">· {v.replyStatus.replace('_', ' ')}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        <p className="text-xs text-gray-400">
          Stages 3–6 (evaluation, POs, GRN) arrive in later phases. Live now: creation, Gate 1, RFQ + vendor tracking, Gate 2.
        </p>
      </div>
    </div>
  )
}
