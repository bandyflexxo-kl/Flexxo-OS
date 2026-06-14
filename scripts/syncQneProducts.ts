/**
 * syncQneProducts.ts
 * Syncs the full product catalogue from QNE Stocks → CRM database.
 *
 * What it does:
 *  - Fetches all active, non-bundled stock items from QNE
 *  - Creates/updates Product records (upserted by qneItemCode)
 *  - Creates SupplierPriceVersion records (using purchasePrice as costPrice)
 *  - Maps QNE category strings to the 12 CRM product categories
 *
 * Run: npx tsx scripts/syncQneProducts.ts
 * Requires: Radmin VPN connected to Flexxokl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import fetch from 'node-fetch'
import { qneParentSlug, qneChildSlug } from '../lib/categorySlug'

const BASE_URL = process.env.QNE_API_BASE_URL ?? 'http://26.255.19.220:82'
const DB_CODE  = process.env.QNE_DB_CODE       ?? 'FKLSB'
const USERNAME = process.env.QNE_API_USERNAME  ?? 'SALES 6'
const PASSWORD = process.env.QNE_API_PASSWORD  ?? '12345'

// ── Category mapping: QNE category string → CRM slug ──────────────────────

const CATEGORY_MAP: Record<string, string> = {
  // Printer consumables
  'PRT CATRIDGE/TONER': 'printer-consumables',
  'PRT CATRIDGE':       'printer-consumables',
  'INK CARTRIDGE':      'printer-consumables',
  'TONER':              'printer-consumables',
  'PRINTER':            'printer-consumables',
  'PRINTING':           'printer-consumables',

  // Stationery
  'STATIONERY':         'office-stationery',
  'OFFICE STATIONERY':  'office-stationery',
  'FILING':             'office-stationery',
  'WRITING':            'office-stationery',

  // Paper
  'PAPER':              'paper',
  'A4 PAPER':           'paper',
  'COPY PAPER':         'paper',

  // Battery
  'BATTERY':            'battery',
  'BATTERIES':          'battery',

  // Pantry & Food
  'PANTRY':             'office-food-pantry',
  'PANTRY/BEVERAGE':    'office-food-pantry',
  'FOOD':               'office-food-pantry',
  'BEVERAGE':           'office-food-pantry',
  'COFFEE':             'office-food-pantry',
  'DRINKING':           'office-food-pantry',

  // Hygiene
  'HYGIENE':            'hygiene-cleaning',
  'CLEANING':           'hygiene-cleaning',
  'SANITARY':           'hygiene-cleaning',
  'TISSUE':             'hygiene-cleaning',

  // Furniture
  'FURNITURE':          'furniture',
  'CHAIR':              'furniture',
  'TABLE':              'furniture',
  'SOFA':               'furniture',
  'CABINET':            'furniture',
  'PARTITION':          'furniture',

  // Thermal roll
  'THERMAL ROLL':       'thermal-roll',
  'THERMAL':            'thermal-roll',
  'THERMAL PAPER':      'thermal-roll',

  // Safety & PPE
  'SAFETY':             'safety-ppe',
  'PPE':                'safety-ppe',
  'SAFETY & PPE':       'safety-ppe',

  // Corporate gift
  'CORPORATE GIFT':     'corporate-gift',
  'GIFT':               'corporate-gift',
  'GIFTS':              'corporate-gift',
  'PREMIUM':            'corporate-gift',

  // Office machine
  'OFFICE MACHINE':     'office-machine',
  'MACHINE':            'office-machine',
  'MACHINES':           'office-machine',
  'EQUIPMENT':          'office-machine',
}

function mapCategory(qneCat: string | null): string {
  if (!qneCat) return 'other'
  const upper = qneCat.trim().toUpperCase()
  // Exact match first
  if (CATEGORY_MAP[upper]) return CATEGORY_MAP[upper]
  // Partial match
  for (const [key, slug] of Object.entries(CATEGORY_MAP)) {
    if (upper.includes(key) || key.includes(upper)) return slug
  }
  return 'other'
}

// ── QNE auth + fetch ───────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res  = await fetch(`${BASE_URL}/api/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
  })
  const data = await res.json() as Record<string, unknown>
  const token = String(data.token ?? data.Token ?? data.accessToken ?? '')
  if (!token) throw new Error(`QNE login failed: ${JSON.stringify(data)}`)
  return token
}

type QneStock = {
  id:            string
  stockCode:     string
  stockName:     string
  baseUOM:       string | null
  listPrice:     number
  purchasePrice: number
  isActive:      boolean
  isBundled:     boolean
  category:      string | null
  class:         string | null   // brand
  group:         string | null
}

async function fetchAllStocks(token: string): Promise<QneStock[]> {
  const headers = { DbCode: DB_CODE, Authorization: `Bearer ${token}` }
  const all: QneStock[] = []
  let skip = 0
  const top  = 200

  console.log('Fetching QNE stocks (paginated)...')

  while (true) {
    const url = `${BASE_URL}/api/Stocks?$top=${top}&$skip=${skip}`
    const res  = await fetch(url, { headers })
    const data = await res.json() as unknown

    const page: QneStock[] = Array.isArray(data)
      ? data as QneStock[]
      : ((data as Record<string, unknown>).value as QneStock[]) ?? ((data as Record<string, unknown>).data as QneStock[]) ?? []

    if (page.length === 0) break
    all.push(...page)
    console.log(`  Fetched ${all.length} items so far...`)
    if (page.length < top) break
    skip += top
  }

  return all
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('../lib/prisma')

  console.log('=== QNE Products Sync ===\n')

  // Get admin user (for approvedById on price versions)
  const admin = await prisma.user.findFirst({
    where:  { isActive: true, userRoles: { some: { role: { name: 'Admin' }, revokedAt: null } } },
    select: { id: true, name: true },
  })
  if (!admin) throw new Error('No admin user found. Run seed first.')
  console.log(`Running as admin: ${admin.name}`)

  // Get category id map (slug → id)
  const categories = await prisma.productCategory.findMany({ select: { id: true, slug: true } })
  const catMap = Object.fromEntries(categories.map(c => [c.slug, c.id]))

  // Find or create "QNE Internal" supplier
  let supplier = await prisma.supplier.findFirst({ where: { nameNormalized: 'qne internal' } })
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name:           'QNE Internal',
        nameNormalized: 'qne internal',
        currency:       'MYR',
        isActive:       true,
      },
    })
    console.log(`Created supplier: ${supplier.name}`)
  } else {
    console.log(`Using existing supplier: ${supplier.name}`)
  }

  // Create a price file record for this batch
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

  // Fetch all stocks from QNE
  const token  = await getToken()
  const stocks = await fetchAllStocks(token)
  console.log(`\nTotal QNE stocks fetched: ${stocks.length}`)

  // Filter: active, not bundled, has a price
  const valid = stocks.filter(s =>
    s.isActive &&
    !s.isBundled &&
    s.stockCode &&
    s.stockName &&
    (s.purchasePrice > 0 || s.listPrice > 0)
  )
  console.log(`Valid items (active, not bundled, has price): ${valid.length}`)

  let created  = 0
  let updated  = 0
  let skipped  = 0
  let errors   = 0

  for (const stock of valid) {
    try {
      // Category assignment — prefer the QNE-mirrored tree (created by
      // scripts/buildCategoryTree.ts): child slug `category--group`, then
      // parent slug `category`. Fall back to the legacy keyword map.
      const rawCat   = stock.category?.trim() || null
      const rawGroup = stock.group?.trim()    || null
      const treeSlug =
        (rawCat && rawGroup && catMap[qneChildSlug(rawCat, rawGroup)] ? qneChildSlug(rawCat, rawGroup) : null) ??
        (rawCat && catMap[qneParentSlug(rawCat)] ? qneParentSlug(rawCat) : null)
      const slug     = treeSlug ?? mapCategory(stock.category)
      const catId    = catMap[slug] ?? catMap['other']
      const brand    = stock.class?.trim() || null
      const unit     = stock.baseUOM?.trim() || null

      // Cost price: prefer purchasePrice, fallback to listPrice * 0.75
      const rawCost  = stock.purchasePrice > 0
        ? stock.purchasePrice
        : Math.round(stock.listPrice * 0.75 * 100) / 100
      const costPrice = rawCost

      // Upsert product by qneItemCode
      const existingProduct = await prisma.product.findFirst({
        where: { qneItemCode: stock.stockCode },
      })

      let product: { id: string }

      // Raw QNE classification: category (top) > group (subcategory) > class (brand)
      const qneCategory = stock.category?.trim() || null
      const qneGroup    = stock.group?.trim()    || null

      if (existingProduct) {
        product = await prisma.product.update({
          where: { id: existingProduct.id },
          data: {
            name:       stock.stockName,
            brand,
            unit,
            categoryId: catId,
            isActive:   true,
            qneCategory,
            qneGroup,
          },
          select: { id: true },
        })
        updated++
      } else {
        product = await prisma.product.create({
          data: {
            name:        stock.stockName,
            brand,
            unit,
            qneItemCode: stock.stockCode,
            categoryId:  catId,
            isActive:    true,
            createdById: admin.id,
            qneCategory,
            qneGroup,
          },
          select: { id: true },
        })
        created++
      }

      // Mark any existing current price as not current
      await prisma.supplierPriceVersion.updateMany({
        where: { productId: product.id, supplierId: supplier.id, isCurrent: true },
        data:  { isCurrent: false },
      })

      // Get next version number
      const lastVersion = await prisma.supplierPriceVersion.findFirst({
        where:   { productId: product.id, supplierId: supplier.id },
        orderBy: { versionNumber: 'desc' },
        select:  { versionNumber: true },
      })
      const versionNumber = (lastVersion?.versionNumber ?? 0) + 1

      // Create staging row (required by schema)
      const staging = await prisma.supplierPriceStaging.create({
        data: {
          fileId:        priceFile.id,
          supplierId:    supplier.id,
          rawItemName:   stock.stockName,
          rawBrand:      brand,
          rawUnit:       unit,
          rawPrice:      String(stock.listPrice),
          rawCurrency:   'MYR',
          parsedCurrency: 'MYR',
          matchedProductId: product.id,
          matchStatus:   'matched',
          stagingStatus: 'promoted',
          reviewedById:  admin.id,
          reviewedAt:    new Date(),
        },
      })

      // Create price version
      await prisma.supplierPriceVersion.create({
        data: {
          supplierId:     supplier.id,
          productId:      product.id,
          stagingRowId:   staging.id,
          versionNumber,
          costPrice,
          currency:       'MYR',
          unit,
          isCurrent:      true,
          sourceFileName: priceFile.fileName,
          approvedById:   admin.id,
          approvedAt:     new Date(),
        },
      })
    } catch (err) {
      console.error(`  ✗ Error for ${stock.stockCode}: ${err}`)
      errors++
    }
  }

  console.log('\n=== SYNC COMPLETE ===')
  console.log(`  Products created:  ${created}`)
  console.log(`  Products updated:  ${updated}`)
  console.log(`  Skipped:           ${skipped}`)
  console.log(`  Errors:            ${errors}`)
  console.log(`\nGo to /admin/products to mark products visible for the portal.`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
