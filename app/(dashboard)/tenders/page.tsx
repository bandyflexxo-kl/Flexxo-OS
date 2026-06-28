import { redirect }       from 'next/navigation'
import Link               from 'next/link'
import { verifySession }  from '@/lib/session'
import { prisma }         from '@/lib/prisma'
import { isPrivilegedRole } from '@/lib/authorization'
import { canCreateTender, STAGE_LABELS, type TenderStage } from '@/lib/tenderAccess'
import Topbar             from '@/components/layout/Topbar'

export const dynamic = 'force-dynamic'

// Tailwind tone per stage for the pill.
const STAGE_TONE: Record<string, string> = {
  creation:    'bg-gray-100 text-gray-700',
  rfq:         'bg-blue-50 text-blue-700',
  evaluation:  'bg-amber-50 text-amber-700',
  client_po:   'bg-indigo-50 text-indigo-700',
  supplier_po: 'bg-violet-50 text-violet-700',
  receiving:   'bg-cyan-50 text-cyan-700',
  closed:      'bg-green-50 text-green-700',
}

const STATUS_TONE: Record<string, string> = {
  active:    'text-gray-600',
  won:       'text-green-700',
  lost:      'text-red-600',
  cancelled: 'text-gray-400',
  expired:   'text-orange-600',
}

function daysTo(date: Date | null): number | null {
  if (!date) return null
  const ms = date.getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export default async function TendersPage() {
  const session = await verifySession().catch(() => null)
  if (!session) redirect('/login')

  const role = session.role

  // Role scoping: privileged + Purchaser + Warehouse see all; Sales Exec sees own.
  const where =
    isPrivilegedRole(role) || role === 'Purchaser' || role === 'Warehouse'
      ? {}
      : { createdById: session.userId }

  const tenders = await prisma.tender.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      createdBy:     { select: { name: true } },
      clientCompany: { select: { id: true, name: true } },
      _count:        { select: { items: true, vendors: true } },
    },
    take: 200,
  })

  const activeCount     = tenders.filter(t => t.status === 'active').length
  const awaitingGate1   = tenders.filter(t => t.stage === 'creation' && t.gate1ApprovalId).length
  const totalEstValue   = tenders.reduce((s, t) => s + Number(t.estValue ?? 0), 0)
  const in3 = Date.now() + 3 * 86400000
  const expiringSoon = tenders.filter(t => t.status === 'active' && ['creation', 'rfq'].includes(t.stage) && t.submissionExpiry && t.submissionExpiry.getTime() <= in3 && t.submissionExpiry.getTime() >= Date.now()).length
  const stageCounts = ['rfq', 'evaluation', 'client_po', 'supplier_po', 'receiving'].map(s => ({ s, c: tenders.filter(t => t.stage === s && t.status === 'active').length })).filter(x => x.c > 0)

  return (
    <div>
      <Topbar
        title="Tenders"
        actions={
          canCreateTender(role) ? (
            <Link
              href="/tenders/new"
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
            >
              + New Tender
            </Link>
          ) : null
        }
      />

      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="flex flex-wrap gap-3">
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-gray-900">{tenders.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
            <p className="text-2xl font-bold text-blue-700">{activeCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">Active</p>
          </div>
          {awaitingGate1 > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
              <p className="text-2xl font-bold text-yellow-700">{awaitingGate1}</p>
              <p className="text-xs text-yellow-600 mt-0.5">Awaiting Gate 1</p>
            </div>
          )}
          {expiringSoon > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 text-center min-w-[110px]">
              <p className="text-2xl font-bold text-orange-700">{expiringSoon}</p>
              <p className="text-xs text-orange-600 mt-0.5">Closing ≤ 3 days</p>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 text-center min-w-[140px]">
            <p className="text-2xl font-bold text-gray-900">
              RM {totalEstValue.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Est. pipeline value</p>
          </div>
        </div>

        {/* Active stage breakdown */}
        {stageCounts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {stageCounts.map(({ s, c }) => (
              <span key={s} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1 text-gray-600">
                {STAGE_LABELS[s as TenderStage]} <span className="font-semibold text-gray-900">{c}</span>
              </span>
            ))}
          </div>
        )}

        {/* Table */}
        {tenders.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center space-y-3">
            <p className="text-4xl">📑</p>
            <p className="text-gray-500 text-sm">No tenders yet.</p>
            {canCreateTender(role) && (
              <p className="text-xs text-gray-400">
                Start one with <Link href="/tenders/new" className="text-blue-600 underline">+ New Tender</Link> — paste the client document and let AI extract the items.
              </p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Ref</th>
                  <th className="px-4 py-3 font-medium">Tender</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Est. value</th>
                  <th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                </tr>
              </thead>
              <tbody>
                {tenders.map(t => {
                  const d = daysTo(t.submissionExpiry)
                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/tenders/${t.id}`} className="font-medium text-blue-600 hover:underline">
                          {t.refNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900 font-medium">{t.name}</p>
                        {t.clientCompany && (
                          <p className="text-xs text-gray-400">{t.clientCompany.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_TONE[t.stage] ?? 'bg-gray-100 text-gray-700'}`}>
                          {STAGE_LABELS[t.stage as TenderStage] ?? t.stage}
                        </span>
                        {t.status !== 'active' && (
                          <span className={`ml-2 text-xs font-medium ${STATUS_TONE[t.status] ?? ''}`}>
                            {t.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{t._count.items}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {t.estValue != null ? `RM ${Number(t.estValue).toLocaleString('en-MY')}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {d == null ? (
                          <span className="text-gray-300">—</span>
                        ) : d < 0 ? (
                          <span className="text-red-600 font-medium">expired</span>
                        ) : d <= 3 ? (
                          <span className="text-orange-600 font-medium">{d}d left</span>
                        ) : (
                          <span className="text-gray-500">{d}d</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{t.createdBy.name}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
