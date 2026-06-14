import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import SuppliersTable from '@/components/admin/SuppliersTable'

export default async function SuppliersPage() {
  const session = await verifySession()
  if (!['Admin','Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Suppliers" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  // Check if the admin has connected Google Drive
  const adminUser = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  const isGoogleConnected = !!adminUser?.googleRefreshToken

  const rawSuppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
    select: {
      id:          true,
      name:        true,
      paymentTerm: true,
      currency:    true,
      isActive:    true,
      _count: { select: { priceFiles: true, priceVersions: true } },
    },
  })

  const suppliers = rawSuppliers.map(s => ({
    id:                s.id,
    name:              s.name,
    paymentTerm:       s.paymentTerm,
    currency:          s.currency,
    isActive:          s.isActive,
    priceFileCount:    s._count.priceFiles,
    priceVersionCount: s._count.priceVersions,
  }))

  return (
    <div>
      <Topbar
        title="Suppliers"
        actions={
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Admin
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">

        {/* Google Drive connection banner */}
        {!isGoogleConnected ? (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📁</span>
              <div>
                <p className="text-sm font-semibold text-blue-900">Connect Google Drive to import supplier price lists</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Your supplier PDFs are in Google Drive — connect once to browse and extract prices directly.
                </p>
              </div>
            </div>
            <a
              href="/api/auth/google?returnUrl=/admin/suppliers"
              className="shrink-0 ml-4 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              🔗 Connect Google Drive
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-5 py-3">
            <span className="text-lg">✅</span>
            <p className="text-sm text-green-800 font-medium">Google Drive connected — browse your Drive from any supplier page.</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{suppliers.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total suppliers</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-blue-600">
              {suppliers.reduce((sum, s) => sum + s.priceVersionCount, 0)}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">Price items on record</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-green-600">
              {suppliers.filter(s => s.isActive).length}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">Active suppliers</p>
          </div>
        </div>

        <SuppliersTable suppliers={suppliers} />
      </div>
    </div>
  )
}
