import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import ProductCatalogTable from '@/components/admin/ProductCatalogTable'
import PhotoReviewTab from '@/components/admin/PhotoReviewTab'
import CatalogHealthTab from '@/components/admin/CatalogHealthTab'
import NewProductButton from '@/components/admin/NewProductButton'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'

type SearchParams = Promise<{ tab?: string }>

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { tab = 'products' } = await searchParams

  const session = await verifySession()
  if (!['Admin', 'Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Product Catalog" />
        <div className="p-4 sm:p-6 lg:p-8 text-sm text-gray-500">Admin access required.</div>
      </div>
    )
  }

  // Always fetch counts (fast — two COUNT queries)
  const [totalCount, scrapedPhotoCount] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: true, photoUrl: { not: null } } }),
  ])

  // Only run the heavy product list query on the Products tab
  let rows:              ProductRow[]   = []
  let globalMargin                      = '30'
  let photoFolderSetting: { value: string } | null = null
  let adminUser: { name: string } | null = null
  let drivePhotoCount                   = 0
  let shopSubcats: { id: string; name: string; parentName: string | null }[] = []

  if (tab === 'products') {
    const [products, globalSetting, folderSetting, admin, subcats] = await Promise.all([
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
      prisma.productCategory.findMany({
        where:   { parentCategoryId: { not: null }, isActive: true },
        select:  { id: true, name: true, parentCategory: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
    ])

    globalMargin       = globalSetting?.value ?? '30'
    photoFolderSetting = folderSetting as { value: string } | null
    adminUser          = admin
    drivePhotoCount    = products.filter(p => p.googleDrivePhotoId).length
    shopSubcats        = subcats.map(c => ({ id: c.id, name: c.name, parentName: c.parentCategory?.name ?? null }))

    rows = products.map(p => {
      const costPrice = p.priceVersions[0]?.costPrice ?? null
      const selling   = costPrice
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
  }

  const visibleCount = rows.filter(r => r.isVisibleToCustomers).length

  return (
    <div>
      <Topbar
        title="Product Catalog"
        actions={<Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Admin</Link>}
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-gray-900">{totalCount.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">Total products</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-blue-600">{tab === 'products' ? visibleCount.toLocaleString() : '—'}</p>
            <p className="text-sm text-gray-500 mt-0.5">Visible to customers</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-green-600">{tab === 'products' ? drivePhotoCount.toLocaleString() : '—'}</p>
            <p className="text-sm text-gray-500 mt-0.5">Drive photos</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-2xl font-bold text-purple-600">{scrapedPhotoCount.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-0.5">Scraped photos</p>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="border-b border-gray-200 flex gap-0">
          <Link
            href="/admin/products?tab=products"
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'products'
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Products
          </Link>
          <Link
            href="/admin/products?tab=photos"
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
              tab === 'photos'
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Photo Review
            {scrapedPhotoCount > 0 && (
              <span className="text-xs font-medium bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5">
                {scrapedPhotoCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/products?tab=health"
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'health'
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Catalog Health
          </Link>
        </div>

        {/* Tab content */}
        {tab === 'products' && (
          <>
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
                  <span>Google Drive connected ({adminUser?.name}) — ready to scan photos.</span>
                </div>
              )
            })()}

            <div className="flex justify-end">
              <NewProductButton shopCategories={shopSubcats} />
            </div>

            <ProductCatalogTable products={rows} globalMargin={globalMargin} />
          </>
        )}

        {tab === 'photos' && <PhotoReviewTab />}

        {tab === 'health' && <CatalogHealthTab />}
      </div>
    </div>
  )
}

type ProductRow = {
  id:                   string
  name:                 string
  brand:                string | null
  unit:                 string | null
  internalSku:          string | null
  qneItemCode:          string | null
  category:             { id: string; name: string; parentName: string | null }
  catalogDescription:   string | null
  defaultMarginPct:     string | null
  googleDrivePhotoId:   string | null
  isVisibleToCustomers: boolean
  costPrice:            string | null
  sellingPrice:         string | null
  currency:             string
}
