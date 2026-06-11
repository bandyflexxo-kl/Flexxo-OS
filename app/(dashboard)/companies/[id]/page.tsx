import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge, { statusColor, temperatureColor } from '@/components/ui/Badge'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isPrivilegedRole } from '@/lib/authorization'
import QneFinancialTab from '@/components/companies/QneFinancialTab'

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await verifySession()
  const { id } = await params
  const { tab = 'overview' } = await searchParams

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { where: { isActive: true }, orderBy: { name: 'asc' } },
      addresses: { where: { isActive: true } },
      tags: { include: { tag: true } },
      assignments: {
        where: { unassignedAt: null },
        include: { user: true },
      },
      pipelineHistory: {
        orderBy: { enteredAt: 'desc' },
        include: { stage: true, changedBy: true },
        take: 20,
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        include: { user: true, contact: true },
        take: 50,
      },
      quotations: {
        orderBy: { createdAt: 'desc' },
        include: { createdBy: true },
        take: 20,
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        include: { quotation: { select: { referenceNo: true } } },
        take: 20,
      },
    },
  })

  if (!company) notFound()

  // Salesperson can only access companies assigned to them
  if (!isPrivilegedRole(session.role)) {
    const hasAccess = company.assignments.some(
      a => a.userId === session.userId && a.unassignedAt === null
    )
    if (!hasAccess) notFound()
  }

  const tabs = [
    'overview', 'contacts', 'addresses', 'pipeline', 'activities', 'quotations', 'orders',
    ...(company.qneCustomerCode ? ['qne'] : []),
  ]

  const currentStage = company.pipelineHistory.find((h) => !h.exitedAt)

  return (
    <div>
      <Topbar
        title={company.name}
        actions={
          <Link
            href={`/contacts/new?companyId=${company.id}`}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            + Add Contact
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Status bar */}
        <div className="flex items-center gap-3 mb-6">
          <Badge color={statusColor(company.status)}>{company.status}</Badge>
          {company.leadTemperature && (
            <Badge color={temperatureColor(company.leadTemperature)}>{company.leadTemperature}</Badge>
          )}
          {currentStage && (
            <span className="text-sm text-gray-500">Pipeline: {currentStage.stage.name}</span>
          )}
          {company.qneCustomerCode && (
            <span className="text-xs text-gray-400">QNE: {company.qneCustomerCode}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-200 mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <Link
              key={t}
              href={`/companies/${id}?tab=${t}`}
              className={`px-4 py-2 text-sm whitespace-nowrap capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'qne' ? '📊 QNE Financial' : t}
            </Link>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
            <Field label="Registration No." value={company.regNumber} />
            <Field label="Industry" value={company.industry} />
            <Field label="Company Size" value={company.companySize} />
            <Field label="General Email" value={company.generalEmail} />
            <Field label="Main Phone" value={company.mainPhone} />
            <Field label="Website" value={company.website} link />
            <Field label="Lead Source" value={company.leadSource} />
            <Field label="Created" value={new Date(company.createdAt).toLocaleDateString()} />
            <div className="sm:col-span-2">
              <p className="text-xs text-gray-400 mb-1">Assigned to</p>
              <div className="flex flex-wrap gap-2">
                {company.assignments.length === 0 ? (
                  <span className="text-sm text-gray-400">Unassigned</span>
                ) : (
                  company.assignments.map((a) => (
                    <span key={a.id} className="text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">
                      {a.user.name} {a.isPrimary ? '(Primary)' : ''}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'contacts' && (
          <div>
            {company.contacts.length === 0 ? (
              <p className="text-sm text-gray-400">No contacts yet. <Link href={`/contacts/new?companyId=${id}`} className="text-blue-600 hover:underline">Add one</Link></p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Position</th>
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Phone</th>
                    <th className="pb-2 font-medium">Decision Maker</th>
                  </tr>
                </thead>
                <tbody>
                  {company.contacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="py-2"><Link href={`/contacts/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link></td>
                      <td className="py-2 text-gray-500">{c.position ?? '—'}</td>
                      <td className="py-2 text-gray-500">{c.email ?? '—'}</td>
                      <td className="py-2 text-gray-500">{c.phone ?? '—'}</td>
                      <td className="py-2">{c.isDecisionMaker ? <Badge color="green">Yes</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'addresses' && (
          <div className="space-y-3">
            {company.addresses.length === 0 ? (
              <p className="text-sm text-gray-400">No addresses on file.</p>
            ) : (
              company.addresses.map((a) => (
                <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex gap-2 mb-1">
                    <Badge>{a.addressType}</Badge>
                    {a.isDefault && <Badge color="blue">Default</Badge>}
                    {a.label && <span className="text-xs text-gray-400">{a.label}</span>}
                  </div>
                  <p className="text-sm text-gray-700">
                    {[a.line1, a.line2, a.city, a.state, a.postcode, a.country].filter(Boolean).join(', ')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'pipeline' && (
          <div className="space-y-3">
            {company.pipelineHistory.map((h) => (
              <div key={h.id} className="flex items-start gap-3 text-sm">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-400 shrink-0" />
                <div>
                  <span className="font-medium text-gray-900">{h.stage.name}</span>
                  <span className="text-gray-400 ml-2">by {h.changedBy.name}</span>
                  {!h.exitedAt && <Badge color="green" >Current</Badge>}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(h.enteredAt).toLocaleDateString()}
                    {h.exitedAt && ` → ${new Date(h.exitedAt).toLocaleDateString()}`}
                  </div>
                  {h.notes && <p className="text-gray-500 mt-1">{h.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'activities' && (
          <div className="space-y-3">
            {company.activities.map((a) => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge>{a.activityType}</Badge>
                    <span className="font-medium text-sm text-gray-900">{a.subject}</span>
                  </div>
                  <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleDateString()}</span>
                </div>
                {a.body && <p className="text-sm text-gray-600 mt-1">{a.body}</p>}
                <p className="text-xs text-gray-400 mt-1">By {a.user.name}{a.contact ? ` · ${a.contact.name}` : ''}</p>
              </div>
            ))}
            {company.activities.length === 0 && <p className="text-sm text-gray-400">No activities yet.</p>}
          </div>
        )}

        {tab === 'quotations' && (
          <div>
            {company.quotations.length === 0 ? (
              <p className="text-sm text-gray-400">No quotations yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Reference</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Total</th>
                    <th className="pb-2 font-medium">Created By</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {company.quotations.map((q) => (
                    <tr key={q.id} className="border-b border-gray-50">
                      <td className="py-2 font-mono">
                        <Link href={`/quotations/${q.id}`} className="text-blue-600 hover:underline">{q.referenceNo}</Link>
                      </td>
                      <td className="py-2"><Badge>{q.status}</Badge></td>
                      <td className="py-2 text-gray-700">{q.totalAmount ? `MYR ${Number(q.totalAmount).toFixed(2)}` : '—'}</td>
                      <td className="py-2 text-gray-500">{q.createdBy.name}</td>
                      <td className="py-2 text-gray-400">{new Date(q.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'orders' && (
          <div>
            {company.orders.length === 0 ? (
              <p className="text-sm text-gray-400">No orders yet. Orders are created when a customer accepts a quotation.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">Order Ref</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Quotation</th>
                    <th className="pb-2 font-medium">Total</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {company.orders.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50">
                      <td className="py-2 font-mono">
                        <Link href={`/orders/${o.id}`} className="text-blue-600 hover:underline">
                          {o.referenceNo ?? o.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-2"><Badge>{o.status}</Badge></td>
                      <td className="py-2 text-gray-500 font-mono text-xs">{o.quotation?.referenceNo ?? '—'}</td>
                      <td className="py-2 text-gray-700">
                        {o.totalAmount ? `${o.currency} ${Number(o.totalAmount).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 text-gray-400">{new Date(o.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'qne' && company.qneCustomerCode && (
          <QneFinancialTab companyId={id} />
        )}
      </div>
    </div>
  )
}

function Field({ label, value, link }: { label: string; value?: string | null; link?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {value ? (
        link ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">{value}</a>
        ) : (
          <p className="text-sm text-gray-900">{value}</p>
        )
      ) : (
        <p className="text-sm text-gray-400">—</p>
      )}
    </div>
  )
}
