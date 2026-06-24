/**
 * lib/qneProductSync.ts
 * Core product catalogue sync logic extracted from scripts/syncQneProducts.ts.
 * Fetches all stocks from QNE → creates/updates/deactivates CRM products.
 * QNE READ-ONLY — only GET calls.
 */

import { prisma }  from '@/lib/prisma'
import { qneLogin, qneGet, QneUnavailableError } from '@/lib/qneClient'
import { classify } from '@/lib/productClassifier'
import { Prisma }   from '@/app/generated/prisma/client'

export type ProductSyncResult = {
  ok:          boolean
  fetched:     number
  created:     number
  updated:     number
  deactivated: number
  errors:      number
}

type QneStock = {
  id?:           string
  stockCode:     string
  stockName:     string
  baseUOM?:      string | null
  listPrice:     number
  purchasePrice: number
  isActive:      boolean
  isBundled:     boolean
  category?:     string | null
  class?:        string | null
  group?:        string | null
  barcode?:      string | null
  ean?:          string | null
  barcodeNo?:    string | null
  eanCode?:      string | null
  upc?:          string | null
  [key: string]: unknown
}

const CATEGORY_MAP: Record<string, string> = {
  'PRT CATRIDGE/TONER': 'printer-consumables',
  'PRT CATRIDGE':       'printer-consumables',
  'INK CARTRIDGE':      'printer-consumables',
  'TONER':              'printer-consumables',
  'PRINTER':            'printer-consumables',
  'PRINTING':           'printer-consumables',
  'STATIONERY':         'office-stationery',
  'OFFICE STATIONERY':  'office-stationery',
  'FILING':             'office-stationery',
  'WRITING':            'office-stationery',
  'PAPER':              'office-stationery',
  'A4 PAPER':           'office-stationery',
  'COPY PAPER':         'office-stationery',
  'BATTERY':            'office-stationery',
  'BATTERIES':          'office-stationery',
  'PANTRY':             'office-food-pantry',
  'PANTRY/BEVERAGE':    'office-food-pantry',
  'FOOD':               'office-food-pantry',
  'BEVERAGE':           'office-food-pantry',
  'COFFEE':             'office-food-pantry',
  'DRINKING':           'office-food-pantry',
  'HYGIENE':            'hygiene-cleaning',
  'CLEANING':           'hygiene-cleaning',
  'SANITARY':           'hygiene-cleaning',
  'TISSUE':             'hygiene-cleaning',
  'FURNITURE':          'furniture',
  'CHAIR':              'furniture',
  'TABLE':              'furniture',
  'SOFA':               'furniture',
  'CABINET':            'furniture',
  'PARTITION':          'furniture',
  'THERMAL ROLL':       'thermal-roll',
  'THERMAL':            'thermal-roll',
  'THERMAL PAPER':      'thermal-roll',
  'SAFETY':             'safety-ppe',
  'PPE':                'safety-ppe',
  'SAFETY & PPE':       'safety-ppe',
  'CORPORATE GIFT':     'office-stationery',
  'GIFT':               'office-stationery',
  'GIFTS':              'office-stationery',
  'PREMIUM':            'office-stationery',
  'OFFICE MACHINE':     'office-machine',
  'MACHINE':            'office-machine',
  'MACHINES':           'office-machine',
  'EQUIPMENT':          'office-machine',
}

function mapCategory(qneCat: string | null | undefined): string {
  if (!qneCat) return 'other'
  const upper = qneCat.trim().toUpperCase()
  if (CATEGORY_MAP[upper]) return CATEGORY_MAP[upper]!
  for (const [key, slug] of Object.entries(CATEGORY_MAP)) {
    if (upper.includes(key) || key.includes(upper)) return slug
  }
  return 'other'
}

export async function syncQneProducts(onProgress?: (msg: string) => void): Promise<ProductSyncResult> {
  onProgress?.('Logging in to QNE…')
  const token = await qneLogin()

  // Fetch all stocks (paginated)
  onProgress?.('Fetching products from QNE…')
  const all: QneStock[] = []
  let skip = 0
  const top = 200

  while (true) {
    const url  = `/Stocks?$top=${top}&$skip=${skip}`
    const raw  = await qneGet<unknown>(url, token)
    const page = (
      Array.isArray(raw)                                       ? raw
      : Array.isArray((raw as Record<string, unknown>).value)  ? (raw as Record<string, unknown>).value
      : Array.isArray((raw as Record<string, unknown>).data)   ? (raw as Record<string, unknown>).data
      : []
    ) as QneStock[]

    if (page.length === 0) break
    all.push(...page)
    onProgress?.(`Fetching products… (${all.length} so far)`)
    if (page.length < top) break
    skip += top
  }

  const valid = all.filter(s =>
    s.isActive && !s.isBundled && s.stockCode && s.stockName &&
    (s.purchasePrice > 0 || s.listPrice > 0)
  )

  const activeCodesInQne = new Set(valid.map(s => s.stockCode.trim().toUpperCase()))

  // Setup: admin user, category map, supplier
  const admin = await prisma.user.findFirst({
    where:  { isActive: true, userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } } },
    select: { id: true },
  })
  if (!admin) throw new Error('No admin user found.')

  const categories = await prisma.productCategory.findMany({ select: { id: true, slug: true } })
  const catMap     = Object.fromEntries(categories.map(c => [c.slug, c.id]))

  let supplier = await prisma.supplier.findFirst({ where: { nameNormalized: 'qne internal' } })
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: { name: 'QNE Internal', nameNormalized: 'qne internal', currency: 'MYR', isActive: true },
    })
  }

  const priceFile = await prisma.supplierPriceFile.create({
    data: {
      supplierId:   supplier.id,
      fileName:     `QNE Stock Sync ${new Date().toISOString().substring(0, 10)}`,
      fileType:     'qne_sync',
      importStatus: 'completed',
      uploadedById: admin.id,
      uploadedAt:   new Date(),
      processedAt:  new Date(),
    },
  })

  onProgress?.(`Syncing ${valid.length} products to database…`)
  let created  = 0
  let updated  = 0
  let errors   = 0

  for (const stock of valid) {
    try {
      const legacyParent = mapCategory(stock.category)
      const { subSlug }  = classify(stock.stockName, legacyParent)
      const catId        = catMap[subSlug] ?? catMap['os--general'] ?? catMap['other']
      const brand        = stock.class?.trim() || null
      const unit         = stock.baseUOM?.trim() || null
      const barcode      = (stock.barcode ?? stock.ean ?? stock.barcodeNo ?? stock.eanCode ?? stock.upc)?.trim() || null
      const rawCost      = stock.purchasePrice > 0 ? stock.purchasePrice : Math.round(stock.listPrice * 0.75 * 100) / 100
      const qneCategory  = stock.category?.trim() || null
      const qneGroup     = stock.group?.trim() || null

      const existing = await prisma.product.findFirst({ where: { qneItemCode: stock.stockCode } })
      let product: { id: string }

      if (existing) {
        product = await prisma.product.update({
          where:  { id: existing.id },
          data:   { name: stock.stockName, brand, unit, categoryId: catId, isActive: true, qneCategory, qneGroup, ...(barcode !== null ? { barcode } : {}) },
          select: { id: true },
        })
        updated++
        const done = created + updated
        if (done % 500 === 0) onProgress?.(`Syncing database (${done}/${valid.length})…`)
      } else {
        product = await prisma.product.create({
          data:   { name: stock.stockName, brand, unit, qneItemCode: stock.stockCode, barcode, categoryId: catId, isActive: true, createdById: admin.id, qneCategory, qneGroup },
          select: { id: true },
        })
        created++
      }

      await prisma.supplierPriceVersion.updateMany({
        where: { productId: product.id, supplierId: supplier.id, isCurrent: true },
        data:  { isCurrent: false },
      })

      const lastVersion = await prisma.supplierPriceVersion.findFirst({
        where: { productId: product.id, supplierId: supplier.id }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true },
      })

      const staging = await prisma.supplierPriceStaging.create({
        data: {
          fileId: priceFile.id, supplierId: supplier.id, rawItemName: stock.stockName,
          rawBrand: brand, rawUnit: unit, rawPrice: String(stock.listPrice), rawCurrency: 'MYR',
          parsedCurrency: 'MYR', matchedProductId: product.id, matchStatus: 'matched',
          stagingStatus: 'promoted', reviewedById: admin.id, reviewedAt: new Date(),
        },
      })

      await prisma.supplierPriceVersion.create({
        data: {
          supplierId: supplier.id, productId: product.id, stagingRowId: staging.id,
          versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
          costPrice: new Prisma.Decimal(rawCost), currency: 'MYR', unit,
          isCurrent: true, sourceFileName: priceFile.fileName,
          approvedById: admin.id, approvedAt: new Date(),
        },
      })
    } catch {
      errors++
    }
  }

  onProgress?.('Checking for removed products…')
  // Deactivate CRM products not returned by QNE this sync (set-difference approach).
  // QNE only returns active items — anything missing from the response is disabled/deleted.
  let deactivated = 0
  const withCode = await prisma.product.findMany({
    where:  { isActive: true, qneItemCode: { not: null } },
    select: { id: true, qneItemCode: true },
  })
  const toDeactivate = withCode.filter(
    p => !activeCodesInQne.has((p.qneItemCode ?? '').trim().toUpperCase())
  )
  if (toDeactivate.length > 0) {
    await prisma.product.updateMany({
      where: { id: { in: toDeactivate.map(p => p.id) } },
      data:  { isActive: false, isVisibleToCustomers: false },
    })
    deactivated = toDeactivate.length
  }

  return { ok: true, fetched: all.length, created, updated, deactivated, errors }
}
