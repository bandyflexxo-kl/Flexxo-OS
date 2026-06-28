import { redirect, notFound } from 'next/navigation'
import Link                from 'next/link'
import { verifySession }   from '@/lib/session'
import { prisma }          from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { canManageGate, canActOnStage, STAGE_LABELS, type TenderStage } from '@/lib/tenderAccess'
import { getSupplierScores } from '@/lib/supplierPerformance'
import { getTenderBalance } from '@/lib/tenderBalance'
import Topbar              from '@/components/layout/Topbar'
import Gate1Button         from '@/components/tenders/Gate1Button'
import TenderRfqPanel, { type PanelVendor } from '@/components/tenders/TenderRfqPanel'
import TenderEvalPanel, { type EvalItemProp } from '@/components/tenders/TenderEvalPanel'
import TenderClientPoPanel, { type CpItem, type CpPo } from '@/components/tenders/TenderClientPoPanel'
import TenderProcurementPanel, { type BalRow, type AwItem, type AwSupplier, type PoRow } from '@/components/tenders/TenderProcurementPanel'

export const dynamic = 'force-dynamic'

const STAGE_TONE: Record<string, string> = {
  creation: 'bg-gray-100 text-gray-700', rfq: 'bg-blue-50 text-blue-700',
  evaluation: 'bg-amber-50 text-amber-700', client_po: 'bg-indigo-50 text-indigo-700',
  supplier_po: 'bg-violet-50 text-violet-700', receiving: 'bg-cyan-50 text-cyan-700',
  closed: 'bg-green-50 text-green-700',
}
const ORDER: TenderStage[] = ['creation', 'rfq', 'evaluation', 'client_po', 'supplier_po', 'receiving', 'closed']
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const n = (v: unknown) => (v == null ? null : Number(v))

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')
  const role = session.role
  const { id } = await params

  const tender = await prisma.tender.findUnique({
    where: { id },
    include: {
      createdBy:     { select: { name: true } },
      clientCompany: { select: { id: true, name: true } },
      items: {
        orderBy: { pos: 'asc' },
        include: {
          awardedSupplier: { select: { name: true } },
          quotes:          { include: { supplier: { select: { name: true } } } },
        },
      },
      vendors:   { include: { supplier: { select: { name: true } } } },
      clientPOs: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true } } } },
      supplierPOs: {
        orderBy: { issuedAt: 'desc' },
        include: { supplier: { select: { name: true } }, items: { include: { tenderItem: { select: { name: true, unit: true } }, grnItems: { select: { qtyReceived: true } } } } },
      },
    },
  })
  if (!tender) notFound()

  const allowed = isPrivilegedRole(role) || role === 'Purchaser' || role === 'Warehouse' || tender.createdById === session.userId
  if (!allowed) redirect('/tenders')

  const stage = tender.stage as TenderStage
  const locked = tender.pricesLockedAt != null
  const awaitingGate1 = stage === 'creation'
  const canAck = awaitingGate1 && canManageGate(role)

  // ── Stage 2 (RFQ) ─────────────────────────────────────────────────────────
  let rfqVendors: PanelVendor[] = []
  let supplierOpts: { id: string; name: string; stars: number; invited: number }[] = []
  if (stage === 'rfq') {
    const allSuppliers = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    const scores = await getSupplierScores(allSuppliers.map(s => s.id))
    rfqVendors = tender.vendors.map(v => {
      const s = scores.get(v.supplierId)
      return { id: v.id, supplierId: v.supplierId, supplierName: v.supplier.name, replyStatus: v.replyStatus, quoteValidityDays: v.quoteValidityDays, rfqSentAt: v.rfqSentAt?.toISOString() ?? null, stars: s?.stars ?? 0, avgReplyHours: s?.avgReplyHours ?? null, won: s?.won ?? 0 }
    })
    supplierOpts = allSuppliers.map(s => ({ id: s.id, name: s.name, stars: scores.get(s.id)?.stars ?? 0, invited: scores.get(s.id)?.invited ?? 0 }))
  }

  // ── Stage 3 (Evaluation) ──────────────────────────────────────────────────
  let evalItems: EvalItemProp[] = []
  let evalVendors: { supplierId: string; supplierName: string }[] = []
  let evalQuotes: { tenderItemId: string; supplierId: string; quotedUnitPrice: number }[] = []
  let threshold = tender.varianceThreshold != null ? Number(tender.varianceThreshold) : 5
  if (stage === 'evaluation') {
    const { getTenderSettings } = await import('@/lib/tenderSettings')
    if (tender.varianceThreshold == null) threshold = (await getTenderSettings()).varianceThreshold
    const matchedIds = tender.items.map(i => i.matchedProductId).filter((x): x is string => !!x)
    const drivePrices = matchedIds.length
      ? await prisma.supplierPriceVersion.findMany({ where: { productId: { in: matchedIds }, isCurrent: true }, select: { productId: true, costPrice: true } })
      : []
    const driveByProduct = new Map(drivePrices.map(d => [d.productId, Number(d.costPrice)]))
    evalItems = tender.items.map(it => ({
      id: it.id, pos: it.pos, name: it.name, unit: it.unit, qty: Number(it.qty),
      normalUnitPrice: n(it.normalUnitPrice), targetPrice: n(it.targetPrice),
      suggestedNormal: it.matchedProductId ? (driveByProduct.get(it.matchedProductId) ?? null) : null,
    }))
    evalVendors = tender.vendors.map(v => ({ supplierId: v.supplierId, supplierName: v.supplier.name }))
    evalQuotes = tender.items.flatMap(it => it.quotes.map(q => ({ tenderItemId: it.id, supplierId: q.supplierId, quotedUnitPrice: Number(q.quotedUnitPrice) })))
  }

  // ── Stage 4 (Client PO) ───────────────────────────────────────────────────
  let cpItems: CpItem[] = []
  let cpPos: CpPo[] = []
  if (stage === 'client_po') {
    cpItems = tender.items.map(it => ({ id: it.id, pos: it.pos, name: it.name, unit: it.unit, qty: Number(it.qty), awardedUnitPrice: n(it.awardedUnitPrice) }))
    cpPos = tender.clientPOs.map(p => ({ id: p.id, poNumber: p.poNumber, value: Number(p.value), dateReceived: p.dateReceived.toISOString(), itemCount: p._count.items }))
  }

  // ── Stage 5/6 (Procurement) ───────────────────────────────────────────────
  let balRows: BalRow[] = []
  let awItems: AwItem[] = []
  let awSuppliers: AwSupplier[] = []
  let poRows: PoRow[] = []
  const showProc = stage === 'supplier_po' || stage === 'receiving' || stage === 'closed'
  if (showProc) {
    const bal = await getTenderBalance(id)
    balRows = bal.items
    const remByItem = new Map(bal.items.map(b => [b.tenderItemId, b.remainingQty]))
    awItems = tender.items.filter(i => i.awardedSupplierId).map(it => ({ id: it.id, name: it.name, unit: it.unit, awardedSupplierId: it.awardedSupplierId, remainingQty: remByItem.get(it.id) ?? 0 }))
    const supMap = new Map<string, string>()
    for (const it of tender.items) if (it.awardedSupplierId && it.awardedSupplier) supMap.set(it.awardedSupplierId, it.awardedSupplier.name)
    awSuppliers = [...supMap.entries()].map(([sid, name]) => ({ id: sid, name }))
    poRows = tender.supplierPOs.map(po => ({
      id: po.id, poNumber: po.poNumber, supplierName: po.supplier.name, status: po.status, ackDate: po.ackDate?.toISOString() ?? null,
      lines: po.items.map(li => ({ id: li.id, itemName: li.tenderItem.name, unit: li.tenderItem.unit, qty: Number(li.qty), received: li.grnItems.reduce((s, g) => s + Number(g.qtyReceived), 0) })),
    }))
  }

  return (
    <div>
      <Topbar title={tender.refNo} />
      <div className="p-6 space-y-5 max-w-4xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{tender.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_TONE[stage]}`}>{STAGE_LABELS[stage]}</span>
              {tender.status !== 'active' && <span className="text-xs text-gray-500">· {tender.status}</span>}
              {locked && <span className="text-xs text-green-700">· 🔒 prices locked {fmtDate(tender.pricesLockedAt)}</span>}
              {tender.clientCompany && <Link href={`/companies/${tender.clientCompany.id}`} className="text-xs text-blue-600 hover:underline">{tender.clientCompany.name}</Link>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a href={`/api/tenders/${tender.id}/schedule`} className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-xs font-medium text-gray-700 px-3 py-2 rounded-lg">⬇ Schedule</a>
            {(locked || stage === 'evaluation') && <a href={`/api/tenders/${tender.id}/evaluation-pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-xs font-medium text-gray-700 px-3 py-2 rounded-lg">⬇ Evaluation</a>}
          </div>
        </div>

        {/* Stage timeline */}
        <div className="flex items-center gap-1 text-[10px] text-gray-400 flex-wrap">
          {ORDER.map((s, i) => {
            const done = ORDER.indexOf(stage) > i
            const cur = stage === s
            return <span key={s} className={`px-2 py-0.5 rounded-full ${cur ? 'bg-blue-100 text-blue-700 font-medium' : done ? 'bg-green-50 text-green-600' : 'bg-gray-50'}`}>{STAGE_LABELS[s]}</span>
          })}
        </div>

        {/* Gate 1 banner */}
        {awaitingGate1 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-yellow-800">Awaiting Gate 1 acknowledgement</p>
              <p className="text-xs text-yellow-700 mt-0.5">The Sales Manager must acknowledge this tender before the RFQ can be sent.</p>
            </div>
            {canAck ? <Gate1Button tenderId={tender.id} /> : <span className="text-xs text-yellow-600 italic shrink-0">Pending Sales Manager</span>}
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
            <div key={k}><p className="text-xs text-gray-400">{k}</p><p className="text-gray-900 mt-0.5">{v}</p></div>
          ))}
          {tender.internalRemarks && <div className="col-span-2 sm:col-span-3"><p className="text-xs text-gray-400">Internal remarks</p><p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{tender.internalRemarks}</p></div>}
        </section>

        {/* Items */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Item schedule ({tender.items.length})</h2></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2 w-10">#</th><th className="px-4 py-2">Item</th><th className="px-4 py-2 w-16">Unit</th><th className="px-4 py-2 w-20">Qty</th><th className="px-4 py-2 w-28">Target</th>
              {locked && <><th className="px-4 py-2">Awarded to</th><th className="px-4 py-2 w-28">Tender price</th></>}
            </tr></thead>
            <tbody>
              {tender.items.map(it => (
                <tr key={it.id} className="border-b border-gray-50">
                  <td className="px-4 py-2 text-gray-400">{it.pos}</td>
                  <td className="px-4 py-2 text-gray-900">{it.name}</td>
                  <td className="px-4 py-2 text-gray-600">{it.unit ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{Number(it.qty)}</td>
                  <td className="px-4 py-2 text-gray-600">{it.targetPrice != null ? `RM ${Number(it.targetPrice)}` : '—'}</td>
                  {locked && <><td className="px-4 py-2 text-gray-700">{it.awardedSupplier?.name ?? '—'}</td><td className="px-4 py-2 font-medium text-gray-900">{it.awardedUnitPrice != null ? `RM ${Number(it.awardedUnitPrice)}` : '—'}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Stage panels */}
        {stage === 'rfq' && (
          <TenderRfqPanel tenderId={tender.id} vendors={rfqVendors} allSuppliers={supplierOpts} canEdit={canActOnStage(role, 'rfq')} canGate={canManageGate(role)} minQuotesRequired={tender.minQuotesRequired} />
        )}
        {stage === 'evaluation' && (
          <TenderEvalPanel tenderId={tender.id} items={evalItems} vendors={evalVendors} quotes={evalQuotes} threshold={threshold} canEdit={canActOnStage(role, 'evaluation')} />
        )}
        {stage === 'client_po' && (
          <TenderClientPoPanel tenderId={tender.id} items={cpItems} pos={cpPos} estValue={n(tender.estValue)} canEdit={canActOnStage(role, 'client_po')} canGate3={canActOnStage(role, 'client_po') || canManageGate(role)} />
        )}
        {showProc && (
          <TenderProcurementPanel
            tenderId={tender.id} balance={balRows} awItems={awItems} suppliers={awSuppliers} pos={poRows}
            canIssue={stage !== 'closed' && canActOnStage(role, 'supplier_po')}
            canReceive={stage !== 'closed' && canActOnStage(role, 'receiving')}
            canClose={stage !== 'closed' && (canManageGate(role) || canActOnStage(role, 'supplier_po'))}
          />
        )}

        {/* Vendors (read-only) for non-RFQ stages */}
        {stage !== 'rfq' && tender.vendors.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Vendors ({tender.vendors.length})</h2>
            <div className="flex flex-wrap gap-2">
              {tender.vendors.map(v => (
                <span key={v.id} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-700">{v.supplier.name}<span className="text-gray-400">· {v.replyStatus.replace('_', ' ')}</span></span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
