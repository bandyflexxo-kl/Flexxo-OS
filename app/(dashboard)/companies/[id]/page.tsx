import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Badge, { statusColor, temperatureColor } from '@/components/ui/Badge'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isPrivilegedRole } from '@/lib/authorization'
import QneFinancialTab from '@/components/companies/QneFinancialTab'
import NewQuotationButton from '@/components/quotations/NewQuotationButton'
import CompanyOverviewPanel from '@/components/companies/CompanyOverviewPanel'
import ContactsPanel from '@/components/companies/ContactsPanel'
import OpenPortalAccountButton from '@/components/companies/OpenPortalAccountButton'

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
      contacts: {
        where:   { isActive: true },
        orderBy: { name: 'asc' },
        include: {
          editRequests: {
            where:   { status: 'pending' },
            include: { requestedBy: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take:    1,
          },
        },
      },
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

  // QNE quotations for this company (created directly in QNE, not via CRM)
  const qneQuotations = await prisma.qneQuotation.findMany({
    where:   { companyId: id },
    include: { items: { select: { stockCode: true, description: true, qty: true, unitPrice: true, lineTotal: true } } },
    orderBy: { docDate: 'desc' },
    take:    50,
  })

  // Salesperson can only access companies assigned to them
  if (!isPrivilegedRole(session.role)) {
    const hasAccess = company.assignments.some(
      a => a.userId === session.userId && a.unassignedAt === null
    )
    if (!hasAccess) notFound()
  }

  // Check if a B2B portal account already exists for this company
  const portalAccount = await prisma.user.findFirst({
    where: {
      customerCompanyId: id,
      userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } },
    },
    select: { id: true, email: true },
  })

  // Primary contact to pre-fill the modal (decision maker with email, else first with email)
  const primaryContact =
    company.contacts.find(c => c.isDecisionMaker && c.email) ??
    company.contacts.find(c => !!c.email) ??
    null

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
          <div className="flex items-center gap-2">
            <OpenPortalAccountButton
              companyId={company.id}
              companyName={company.name}
              existingAccount={portalAccount}
              primaryContact={primaryContact ? { name: primaryContact.name, email: primaryContact.email ?? '' } : null}
            />
            <Link
              href={`/contacts/new?companyId=${company.id}`}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              + Add Contact
            </Link>
          </div>
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
          <CompanyOverviewPanel
            company={{
              id:             company.id,
              name:           company.name,
              regNumber:      company.regNumber,
              tinNumber:      company.tinNumber,
              industry:       company.industry,
              companySize:    company.companySize,
              generalEmail:   company.generalEmail,
              mainPhone:      company.mainPhone,
              website:        company.website,
              leadSource:     company.leadSource,
              status:         company.status,
              leadTemperature: company.leadTemperature,
              assignments:    company.assignments.map(a => ({
                id:        a.id,
                isPrimary: a.isPrimary,
                user:      { name: a.user.name },
              })),
            }}
            canEdit={isPrivilegedRole(session.role)}
            createdAt={new Date(company.createdAt).toLocaleDateString()}
          />
        )}

        {tab === 'contacts' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Contacts</h3>
              <Link
                href={`/contacts/new?companyId=${id}`}
                className="text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                + Add Contact
              </Link>
            </div>
            <ContactsPanel
              companyId={id}
              canEditDirect={isPrivilegedRole(session.role)}
              contacts={company.contacts.map(c => ({
                id:              c.id,
                name:            c.name,
                position:        c.position,
                department:      c.department,
                email:           c.email,
                phone:           c.phone,
                whatsapp:        c.whatsapp,
                isDecisionMaker: c.isDecisionMaker,
                pendingRequest:  c.editRequests[0]
                  ? {
                      id:          c.editRequests[0].id,
                      requestedBy: { name: c.editRequests[0].requestedBy.name },
                      changes:     c.editRequests[0].changes as Record<string, unknown>,
                      createdAt:   c.editRequests[0].createdAt.toISOString(),
                    }
                  : null,
              }))}
            />
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
          <div className="space-y-6">
            {/* CRM Quotations */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">CRM Quotations</h3>
                <NewQuotationButton companyId={company.id} />
              </div>
              {company.quotations.length === 0 ? (
                <p className="text-sm text-gray-400">No quotations created in Flexxo OS yet.</p>
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

            {/* QNE Quotations (created directly in QNE) */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-700">QNE Quotations</h3>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">created directly in QNE</span>
              </div>
              {qneQuotations.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No QNE quotations synced yet.{' '}
                  {!company.qneCustomerCode && <span className="text-amber-600">This company has no QNE customer code linked.</span>}
                  {company.qneCustomerCode && <span>Go to Admin → ↻ Sync QNE Quotations to pull them in.</span>}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-medium">QNE Ref</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Total</th>
                      <th className="pb-2 font-medium">Salesperson</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qneQuotations.map((q) => (
                      <tr key={q.id} className="border-b border-gray-50">
                        <td className="py-2 font-mono text-gray-800">{q.docNo}</td>
                        <td className="py-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            q.status === 'Confirmed' ? 'bg-green-100 text-green-700' :
                            q.status === 'Expired'   ? 'bg-red-100 text-red-600' :
                            'bg-gray-100 text-gray-600'
                          }`}>{q.status ?? 'Open'}</span>
                        </td>
                        <td className="py-2 text-gray-700">MYR {Number(q.totalAmount).toFixed(2)}</td>
                        <td className="py-2 text-gray-500">{q.salesperson ?? '—'}</td>
                        <td className="py-2 text-gray-400">{new Date(q.docDate).toLocaleDateString()}</td>
                        <td className="py-2 text-gray-400">{q.items.length} line{q.items.length !== 1 ? 's' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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

