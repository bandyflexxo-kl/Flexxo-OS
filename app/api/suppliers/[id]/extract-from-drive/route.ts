import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { downloadDriveFile, normaliseStem } from '@/lib/googleDrive'
import { extractPricesFromPdf, extractPricesFromImage } from '@/lib/pdfExtract'
import { z } from 'zod'
import type { Prisma } from '@/app/generated/prisma/client'
import crypto from 'crypto'
import * as XLSX from 'xlsx'

const Schema = z.object({
  fileId:        z.string().min(1),
  fileName:      z.string().min(1),
  mimeType:      z.string().default('application/pdf'),
  fileSizeBytes: z.number().int().nonnegative().optional(),
})

const XLSX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// ── XLSX column detection (ported from price-files/route.ts) ─────────────────
const ITEM_ALIASES  = ['item', 'product', 'description', 'name', 'goods', 'material', 'sku', 'code']
const PRICE_ALIASES = ['price', 'cost', 'rate', 'unit price', 'unit cost', 'selling price', 'trade price', 'nett', 'net', 'amount']
const BRAND_ALIASES = ['brand', 'manufacturer', 'make', 'mfr', 'mfg']
const UNIT_ALIASES  = ['unit', 'uom', 'pack', 'packing', 'size', 'each']

function matchHdr(h: string, aliases: string[]) { return aliases.some(a => h.toLowerCase().includes(a)) }

function detectCols(headers: string[]) {
  const r = { item: 0, price: 3, brand: -1, unit: -1 }
  headers.forEach((h, i) => {
    if (r.item  === 0  && matchHdr(h, ITEM_ALIASES))  r.item  = i
    if (r.price === 3  && matchHdr(h, PRICE_ALIASES)) r.price = i
    if (r.brand === -1 && matchHdr(h, BRAND_ALIASES)) r.brand = i
    if (r.unit  === -1 && matchHdr(h, UNIT_ALIASES))  r.unit  = i
  })
  return r
}

function toNum(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

// ── Token-Jaccard fuzzy match ────────────────────────────────────────────────
function tokenJaccard(a: string, b: string): number {
  const setA = new Set(normaliseStem(a).split(/\s+/).filter(Boolean))
  const setB = new Set(normaliseStem(b).split(/\s+/).filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return 0
  let inter = 0
  for (const t of setA) { if (setB.has(t)) inter++ }
  return inter / (setA.size + setB.size - inter)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: supplierId } = await params

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } })
  if (!supplier) return Response.json({ error: 'Supplier not found' }, { status: 404 })

  const user = await prisma.user.findUnique({
    where:  { id: session.userId },
    select: { googleRefreshToken: true },
  })
  if (!user?.googleRefreshToken) {
    return Response.json({ error: 'Google Drive not connected.' }, { status: 403 })
  }

  const body   = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'fileId and fileName are required.' }, { status: 400 })
  }

  const { fileId, fileName, mimeType, fileSizeBytes } = parsed.data

  // 1. Download file
  let fileBuffer: Buffer
  try {
    fileBuffer = await downloadDriveFile(user.googleRefreshToken, fileId)
  } catch (err) {
    return Response.json({ error: `Drive download failed: ${err instanceof Error ? err.message : err}` }, { status: 502 })
  }

  // 2. Deduplicate by MD5 hash
  const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex')
  const existing = await prisma.supplierPriceFile.findFirst({
    where: { fileHash, supplierId },
    select: { id: true, fileName: true, importStatus: true },
  })
  if (existing) {
    return Response.json({
      duplicate: true,
      existingFileId:   existing.id,
      existingFileName: existing.fileName,
    }, { status: 409 })
  }

  // 3. Catalogue warning: images >20 MB or XLSX/PDF with >1000 rows are likely catalogues, not price lists
  const sizeBytes = fileSizeBytes ?? fileBuffer.byteLength
  const isMaybeCatalogue = IMAGE_TYPES.has(mimeType) && sizeBytes > 20 * 1024 * 1024

  // 4. Create price file record
  const priceFile = await prisma.supplierPriceFile.create({
    data: {
      supplierId,
      fileName,
      googleDriveFileId: fileId,
      fileHash,
      fileType:     mimeType.includes('image') ? 'image'
                  : mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv') ? 'xlsx'
                  : 'pdf',
      importStatus: 'processing',
      uploadedById: session.userId,
    },
  })

  try {
    // 5. Extract based on file type
    let extractedRows: Awaited<ReturnType<typeof extractPricesFromPdf>>

    if (IMAGE_TYPES.has(mimeType)) {
      extractedRows = await extractPricesFromImage(fileBuffer, mimeType)
    } else if (XLSX_TYPES.has(mimeType)) {
      extractedRows = await extractFromXlsx(fileBuffer, supplier.name)
    } else {
      // extractPricesFromPdf already routes large (>30 MB) files via text extraction
      extractedRows = await extractPricesFromPdf(fileBuffer)
    }

    if (extractedRows.length === 0) {
      await prisma.supplierPriceFile.update({
        where: { id: priceFile.id },
        data:  { importStatus: 'failed', rowsExtracted: 0, rowsFailed: 0, processedAt: new Date() },
      })
      return Response.json({
        error:          'No price rows could be extracted.',
        isMaybeCatalogue,
      }, { status: 422 })
    }

    // 6. Auto-match extracted rows to products (token-Jaccard + exact item code)
    const allProducts = await prisma.product.findMany({
      where:  { isActive: true },
      select: { id: true, name: true, qneItemCode: true },
    })

    const stagingData: Prisma.SupplierPriceStagingCreateManyInput[] = extractedRows.map(row => {
      const rawName  = row.code ? `${row.code} — ${row.description}` : row.description
      const itemCode = row.code.trim().toUpperCase()

      // Try exact item code match first
      let matchedProductId: string | null = null
      let matchStatus: string = 'no_match'
      let aiConfidenceScore: number | null = null

      const exactMatch = itemCode
        ? allProducts.find(p => p.qneItemCode?.toUpperCase() === itemCode) ?? null
        : null

      if (exactMatch) {
        matchedProductId  = exactMatch.id
        matchStatus       = 'matched'
        aiConfidenceScore = 1.0
      } else {
        // Fuzzy match by description
        let bestScore = 0
        let bestId: string | null = null
        for (const p of allProducts) {
          const score = tokenJaccard(row.description, p.name)
          if (score > bestScore) { bestScore = score; bestId = p.id }
        }
        if (bestScore >= 0.65) {
          matchedProductId  = bestId
          matchStatus       = 'matched'
          aiConfidenceScore = bestScore
        } else if (bestScore >= 0.40) {
          matchedProductId  = bestId
          matchStatus       = 'possible_match'
          aiConfidenceScore = bestScore
        }
      }

      return {
        fileId:               priceFile.id,
        supplierId,
        rawItemName:          rawName,
        rawBrand:             supplier.name,
        rawUnit:              row.packing ?? null,
        rawPrice:             String(row.price),
        rawCurrency:          supplier.currency,
        parsedPrice:          row.price,
        parsedCurrency:       supplier.currency,
        aiSuggestedProductName: row.category ?? null,
        matchedProductId,
        matchStatus,
        aiConfidenceScore,
        stagingStatus:        'pending_review',
      } satisfies Prisma.SupplierPriceStagingCreateManyInput
    })

    await prisma.supplierPriceStaging.createMany({ data: stagingData })

    const matchedCount  = stagingData.filter(r => r.matchStatus === 'matched').length
    const possibleCount = stagingData.filter(r => r.matchStatus === 'possible_match').length

    await prisma.supplierPriceFile.update({
      where: { id: priceFile.id },
      data: {
        importStatus:      'completed',
        totalRowsDetected: extractedRows.length,
        rowsExtracted:     extractedRows.length,
        rowsFailed:        0,
        processedAt:       new Date(),
      },
    })

    return Response.json({
      fileId:          priceFile.id,
      extracted:       extractedRows.length,
      stagingCount:    extractedRows.length,
      matchedCount,
      possibleCount,
      isMaybeCatalogue,
    }, { status: 201 })

  } catch (err) {
    await prisma.supplierPriceFile.update({
      where: { id: priceFile.id },
      data:  { importStatus: 'failed', processedAt: new Date() },
    }).catch(() => null)

    const msg = err instanceof Error ? err.message : 'Extraction failed'
    return Response.json({ error: msg }, { status: 500 })
  }
}

// ── XLSX extraction ───────────────────────────────────────────────────────────
type PdfRow = Awaited<ReturnType<typeof extractPricesFromPdf>>[number]

async function extractFromXlsx(buffer: Buffer, supplierName: string): Promise<PdfRow[]> {
  const wb    = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows  = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })

  if (rows.length < 2) return []

  const headers = (rows[0] as string[]).map(String)
  const cols    = detectCols(headers)

  const result: PdfRow[] = []
  for (const row of rows.slice(1)) {
    const arr = row as unknown[]
    const desc  = String(arr[cols.item] ?? '').trim()
    const price = toNum(arr[cols.price])
    if (!desc || price === null || price <= 0) continue

    result.push({
      code:        '',
      description: desc,
      colour:      null,
      packing:     cols.unit >= 0 ? String(arr[cols.unit] ?? '').trim() || null : null,
      price,
      category:    cols.brand >= 0 ? String(arr[cols.brand] ?? '').trim() || supplierName : null,
    })
  }
  return result
}
