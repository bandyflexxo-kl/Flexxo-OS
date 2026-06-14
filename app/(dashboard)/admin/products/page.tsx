import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import ProductCatalogTable from '@/components/admin/ProductCatalogTable'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'

export default async function AdminProductsPage() {
  const session = await verifySession()
  if (!['Admin','Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Product Catalog" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  const [products, globalSetting, photoFolderSetting, adminUser] = await Promise.all([
    prisma.product.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        category:      { select: { id: true, name: true, defaultMarginPct: true, parentCategory: { select: { name: true } } } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
    prisma.systemSetting.findUnique({ where: { key: 'google_drive_photos_folder_id' } }),
    prisma.user.findFirst({
      where: {
        isActive: true,
        googleRefreshToken: { not: null },
        userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } },
      },
      select: { name: true },
    }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  const rows = products.map(p => {
    const costPrice  = p.priceVersions[0]?.costPrice ?? null
    const selling    = costPrice
      ? roundPrice(calculateSellingPrice(costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin))
      : null
    return {
      id:                   p.id,
      name:                 p.name,
      brand:                p.brand,
      unit:                 p.unit,
      internalSku:          p.internalSku,
      qneItemCode:          p.qneItemCode,
      category:             { id: p.category.id, name: p.category.name, parentName: p.category.parentCategory?.name ?? null },
      catalogDescription:   p.catalogDescription,
      defaultMarginPct:     p.defaultMarginPct?.toString() ?? null,
      googleDrivePhotoId:   p.googleDrivePhotoId,
      isVisibleToCustomers: p.isVisibleToCustomers,
      costPrice:            costPrice?.toString() ?? null,
      sellingPrice:         selling?.toString() ?? null,
      currency:             p.priceVersions[0]?.currency ?? 'MYR',
    }
  })

  const visibleCount = rows.filter(r => r.isVisibleToCustomers).length
  const photoCount   = rows.filter(r => r.googleDrivePhotoId).length

  return (
    <div>
      <Topbar
        title="Product Catalog"
        actions={<Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>}
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{rows.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total products</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-blue-600">{visibleCount}</p>
            <p className="text-sm text-gray-500 mt-0.5">Visible to customers</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-green-600">{photoCount}</p>
            <p className="text-sm text-gray-500 mt-0.5">With photos</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-700">{globalMargin}%</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Default margin ·{' '}
              <Link href="/admin/settings" className="text-blue-600 hover:underline">Change</Link>
            </p>
          </div>
        </div>

        {/* Google Drive status banners */}
        {(() => {
          const folderConfigured = !!(process.env.GOOGLE_DRIVE_PRODUCT_PHOTOS_FOLDER_ID || photoFolderSetting?.value)
          const driveConnected   = !!adminUser

          if (!folderConfigured) return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800 space-y-1">
              <p className="font-semibold">⚠ Product photos folder not set</p>
              <p>Go to <a href="/admin/settings" className="underline font-medium">Admin → Settings</a> → paste your Google Drive folder ID under <strong>Product Photos Folder ID</strong>.</p>
            </div>
          )

          if (!driveConnected) return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800 space-y-1">
              <p className="font-semibold">⚠ Google Drive not connected</p>
              <p>
                Folder ID is set ✓ — but no admin has authorised Google Drive access yet.
                Go to <a href="/admin/settings" className="underline font-medium">Admin → Settings</a> → click <strong>Connect Google Account</strong> and sign in.
              </p>
            </div>
          )

          return (
            <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 text-sm text-green-800 flex items-center gap-2">
              <span>✓</span>
              <span>Google Drive connected ({adminUser.name}) — ready to scan photos.</span>
            </div>
          )
        })()}

        <ProductCatalogTable products={rows} globalMargin={globalMargin} />
      </div>
    </div>
  )
}
