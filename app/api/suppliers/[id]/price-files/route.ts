import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/app/generated/prisma/client'
import * as XLSX from 'xlsx'

// Column name aliases for auto-detection
const ITEM_ALIASES    = ['item', 'product', 'description', 'name', 'goods', 'material', 'sku', 'code']
const BRAND_ALIASES   = ['brand', 'manufacturer', 'make', 'mfr', 'mfg']
const UNIT_ALIASES    = ['unit', 'uom', 'pack', 'packing', 'size', 'each']
const PRICE_ALIASES   = ['price', 'cost', 'rate', 'unit price', 'unit cost', 'selling price', 'trade price', 'nett', 'net', 'amount']
const MOQ_ALIASES     = ['moq', 'min qty', 'minimum qty', 'min order', 'minimum order', 'minimum']
const VALIDITY_ALIASES = ['valid until', 'validity', 'valid to', 'expiry', 'expire', 'valid date', 'price valid']

function matchHeader(header: string, aliases: string[]): boolean {
  const h = header.toLowerCase().trim()
  return aliases.some(a => h.includes(a))
}

function detectColumns(headers: string[]): {
  item: number; brand: number; unit: number; price: number; moq: number; validity: number
} {
  const result = { item: -1, brand: -1, unit: -1, price: -1, moq: -1, validity: -1 }
  headers.forEach((h, i) => {
    if (result.item     === -1 && matchHeader(h, ITEM_ALIASES))     result.item     = i
    if (result.brand    === -1 && matchHeader(h, BRAND_ALIASES))    result.brand    = i
    if (result.unit     === -1 && matchHeader(h, UNIT_ALIASES))     result.unit     = i
    if (result.price    === -1 && matchHeader(h, PRICE_ALIASES))    result.price    = i
    if (result.moq      === -1 && matchHeader(h, MOQ_ALIASES))      result.moq      = i
    if (result.validity === -1 && matchHeader(h, VALIDITY_ALIASES)) result.validity = i
  })

  // Fallback: if no item column found, use column 0; if no price found use column 3
  if (result.item  === -1) result.item  = 0
  if (result.price === -1) result.price = 3

  return result
}

function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw).replace(/[^0-9.]/g, '')
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function parseMoq(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const num = parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
  return isNaN(num) ? null : num
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null
  if (raw instanceof Date) return raw
  const str = String(raw).trim()
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: supplierId } = await params

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } })
  if (!supplier) return Response.json({ error: 'Supplier not found' }, { status: 404 })

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel',                                           // xls
    'text/csv',
    'application/csv',
  ]
  const fileExt = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['xlsx', 'xls', 'csv'].includes(fileExt)) {
    return Response.json({ error: 'Only .xlsx, .xls or .csv files are supported.' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Parse with xlsx
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch {
    return Response.json({ error: 'Could not parse file. Please upload a valid Excel or CSV file.' }, { status: 400 })
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return Response.json({ error: 'File is empty.' }, { status: 400 })

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][]

  if (rows.length < 2) return Response.json({ error: 'File has no data rows.' }, { status: 400 })

  // Find header row — first row with more than 2 non-empty cells
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nonEmpty = rows[i].filter(cell => String(cell).trim() !== '').length
    if (nonEmpty >= 2) { headerRowIdx = i; break }
  }

  const headers = rows[headerRowIdx].map(h => String(h ?? ''))
  const cols    = detectColumns(headers)
  const dataRows = rows.slice(headerRowIdx + 1)

  // Create SupplierPriceFile record
  const priceFile = await prisma.supplierPriceFile.create({
    data: {
      supplierId,
      fileName:         file.name,
      fileType:         fileExt,
      importStatus:     'processing',
      totalRowsDetected: dataRows.length,
      uploadedById:     session.userId,
    },
  })

  // Parse and create staging rows
  let extracted = 0
  let failed    = 0

  const stagingData: Prisma.SupplierPriceStagingCreateManyInput[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rawItem = String(row[cols.item] ?? '').trim()
    if (!rawItem) continue // skip blank rows

    const rawPrice   = cols.price    >= 0 ? row[cols.price]    : null
    const rawBrand   = cols.brand    >= 0 ? String(row[cols.brand]   ?? '').trim() : null
    const rawUnit    = cols.unit     >= 0 ? String(row[cols.unit]    ?? '').trim() : null
    const rawMoq     = cols.moq      >= 0 ? row[cols.moq]     : null
    const rawValidity = cols.validity >= 0 ? row[cols.validity] : null

    const parsedPrice     = parsePrice(rawPrice)
    const parsedMoq       = parseMoq(rawMoq)
    const parsedValidUntil = parseDate(rawValidity)

    if (parsedPrice !== null && parsedPrice > 0) {
      extracted++
    } else {
      failed++
    }

    stagingData.push({
      fileId:        priceFile.id,
      supplierId,
      rawRowNumber:  headerRowIdx + 1 + i + 1,
      rawItemName:   rawItem || null,
      rawBrand:      rawBrand || null,
      rawUnit:       rawUnit  || null,
      rawPrice:      rawPrice !== null ? String(rawPrice) : null,
      rawCurrency:   supplier.currency,
      rawMoq:        rawMoq   !== null ? String(rawMoq) : null,
      rawValidity:   rawValidity !== null ? String(rawValidity) : null,
      parsedPrice:   parsedPrice ?? undefined,
      parsedCurrency: supplier.currency,
      parsedMoq:     parsedMoq ?? undefined,
      parsedValidUntil: parsedValidUntil ?? undefined,
      stagingStatus: 'pending_review',
    })
  }

  if (stagingData.length > 0) {
    await prisma.supplierPriceStaging.createMany({ data: stagingData })
  }

  await prisma.supplierPriceFile.update({
    where: { id: priceFile.id },
    data: {
      importStatus:  'completed',
      rowsExtracted: extracted,
      rowsFailed:    failed,
      processedAt:   new Date(),
    },
  })

  return Response.json({
    fileId:        priceFile.id,
    totalRows:     dataRows.length,
    extracted,
    failed,
    stagingCount:  stagingData.length,
  }, { status: 201 })
}
