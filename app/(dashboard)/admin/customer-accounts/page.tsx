import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import CustomerAccountsTable from '@/components/admin/CustomerAccountsTable'

export default async function CustomerAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ prefill?: string }>
}) {
  const session = await verifySession()
  if (session.role !== 'Admin') {
    return (
      <div>
        <Topbar title="Customer Accounts" />
        <div className="p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  // Support ?prefill={"name":"...","email":"...","companyName":"..."} from account-requests page
  const sp = await searchParams
  let prefill: { name?: string; email?: string; companyName?: string } | null = null
  if (sp.prefill) {
    try { prefill = JSON.parse(decodeURIComponent(sp.prefill)) as typeof prefill }
    catch { /* ignore malformed prefill */ }
  }

  const [rawAccounts, companies] = await Promise.all([
    prisma.user.findMany({
      where:   { userRoles: { some: { role: { name: 'B2B Client' }, revokedAt: null } } },
      select:  {
        id:                true,
        name:              true,
        email:             true,
        isActive:          true,
        lastLoginAt:       true,
        customerCompanyId: true,
        customerCompany:   { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.company.findMany({
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    }),
  ])

  const accounts = rawAccounts.map(u => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }))

  return (
    <div>
      <Topbar
        title="Customer Portal Accounts"
        actions={<Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{accounts.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total portal accounts</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-green-600">{accounts.filter(a => a.isActive).length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Active</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-orange-500">{accounts.filter(a => a.lastLoginAt === null).length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Never logged in</p>
          </div>
        </div>

        {prefill && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <span>🆕</span>
            <span>Pre-filled from account request: <strong>{prefill.name}</strong> ({prefill.companyName}). Select the matching company below and set a password.</span>
          </div>
        )}
        <CustomerAccountsTable accounts={accounts} companies={companies} prefill={prefill} />
      </div>
    </div>
  )
}
