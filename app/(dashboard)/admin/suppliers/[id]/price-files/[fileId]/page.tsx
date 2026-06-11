import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import PriceFileStagingTable from '@/components/admin/PriceFileStagingTable'
import { notFound } from 'next/navigation'

export default async function PriceFileStagingPage({
  params,
}: {
  params: Promise<{ id: string; fileId: string }>
}) {
  const session = await verifySession()
  if (session.role !== 'Admin') {
    return (
      <div>
        <Topbar title="Price File Review" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  const { id: supplierId, fileId } = await params

  const [priceFile, categories] = await Promise.all([
    prisma.supplierPriceFile.findUnique({
      where: { id: fileId },
      include: {
        supplier: { select: { id: true, name: true } },
        stagingRows: {
          orderBy: { rawRowNumber: 'asc' },
          select: {
            id:              true,
            rawRowNumber:    true,
            rawItemName:     true,
            rawBrand:        true,
            rawUnit:         true,
            rawPrice:        true,
            parsedPrice:     true,
            parsedCurrency:  true,
            parsedMoq:       true,
            parsedValidUntil: true,
            stagingStatus:   true,
          },
        },
      },
    }),
    prisma.productCategory.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    }),
  ])

  if (!priceFile || priceFile.supplier.id !== supplierId) notFound()

  const statusCounts = priceFile.stagingRows.reduce(
    (acc, r) => {
      if (r.stagingStatus === 'pending_review') acc.pending++
      else if (r.stagingStatus === 'approved')  acc.approved++
      else if (r.stagingStatus === 'rejected')  acc.rejected++
      return acc
    },
    { pending: 0, approved: 0, rejected: 0 }
  )

  const rows = priceFile.stagingRows.map(r => ({
    ...r,
    parsedPrice:     r.parsedPrice     ? Number(r.parsedPrice)                  : null,
    parsedMoq:       r.parsedMoq       ?? null,
    parsedValidUntil: r.parsedValidUntil?.toISOString() ?? null,
  }))

  return (
    <div>
      <Topbar
        title={`Review: ${priceFile.fileName}`}
        actions={
          <Link href={`/admin/suppliers/${supplierId}`} className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to {priceFile.supplier.name}
          </Link>
        }
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-8 text-sm">
          <div>
            <p className="text-xs text-gray-400">File</p>
            <p className="font-medium text-gray-900 font-mono text-xs mt-0.5">{priceFile.fileName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Supplier</p>
            <p className="font-medium text-gray-900 mt-0.5">{priceFile.supplier.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Rows extracted</p>
            <p className="font-medium text-gray-900 mt-0.5">{priceFile.rowsExtracted ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Skipped</p>
            <p className="font-medium text-gray-400 mt-0.5">{priceFile.rowsFailed ?? 0}</p>
          </div>
        </div>

        <PriceFileStagingTable
          rows={rows}
          categories={categories}
          stats={statusCounts}
          supplierId={supplierId}
        />
      </div>
    </div>
  )
}
