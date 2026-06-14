import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import SupplierDetail from '@/components/admin/SupplierDetail'
import { notFound } from 'next/navigation'

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession()
  if (!['Admin','Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Supplier" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  const { id } = await params

  const [supplier, adminUser] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id },
      include: {
        priceFiles: {
          orderBy: { uploadedAt: 'desc' },
          include: {
            uploadedBy: { select: { name: true } },
            _count: { select: { stagingRows: { where: { stagingStatus: 'pending_review' } } } },
          },
        },
      },
    }),
    prisma.user.findUnique({
      where:  { id: session.userId },
      select: { googleRefreshToken: true },
    }),
  ])

  if (!supplier) notFound()

  const isGoogleConnected = !!adminUser?.googleRefreshToken
  const rootFolderId      = process.env.GOOGLE_DRIVE_FOLDER_ID ?? ''
  const currentUrl        = `/admin/suppliers/${id}`

  const supplierData = {
    id:          supplier.id,
    name:        supplier.name,
    paymentTerm: supplier.paymentTerm,
    currency:    supplier.currency,
    isActive:    supplier.isActive,
    priceFiles:  supplier.priceFiles.map(f => ({
      id:            f.id,
      fileName:      f.fileName,
      fileType:      f.fileType,
      importStatus:  f.importStatus,
      rowsExtracted: f.rowsExtracted,
      rowsFailed:    f.rowsFailed,
      stagingCount:  f._count.stagingRows,
      uploadedAt:    f.uploadedAt.toISOString(),
      processedAt:   f.processedAt?.toISOString() ?? null,
      uploadedBy:    f.uploadedBy,
    })),
  }

  return (
    <div>
      <Topbar
        title={supplier.name}
        actions={
          <Link href="/admin/suppliers" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Suppliers
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8">
        <SupplierDetail
          supplier={supplierData}
          isGoogleConnected={isGoogleConnected}
          rootFolderId={rootFolderId}
          currentUrl={currentUrl}
        />
      </div>
    </div>
  )
}
