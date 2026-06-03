import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { downloadDriveFile } from '@/lib/googleDrive'
import { extractPricesFromPdf } from '@/lib/pdfExtract'
import { z } from 'zod'
import type { Prisma } from '@/app/generated/prisma/client'

const Schema = z.object({
  fileId:   z.string().min(1),
  fileName: z.string().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'Admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

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

  const { fileId, fileName } = parsed.data

  // Create a price file record straight away so the user can see progress
  const priceFile = await prisma.supplierPriceFile.create({
    data: {
      supplierId,
      fileName,
      googleDriveFileId: fileId,
      fileType:     'pdf',
      importStatus: 'processing',
      uploadedById: session.userId,
    },
  })

  try {
    // 1. Download PDF from Google Drive
    const pdfBuffer = await downloadDriveFile(user.googleRefreshToken, fileId)

    // 2. Send to Claude for extraction
    const rows = await extractPricesFromPdf(pdfBuffer)

    if (rows.length === 0) {
      await prisma.supplierPriceFile.update({
        where: { id: priceFile.id },
        data:  { importStatus: 'failed', rowsExtracted: 0, rowsFailed: 0, processedAt: new Date() },
      })
      return Response.json({ error: 'No price rows could be extracted from the PDF.' }, { status: 422 })
    }

    // 3. Build staging rows
    const stagingData: Prisma.SupplierPriceStagingCreateManyInput[] = rows.map(row => ({
      fileId:        priceFile.id,
      supplierId,
      rawItemName:   row.code ? `${row.code} — ${row.description}` : row.description,
      rawBrand:      supplier.name,
      rawUnit:       row.packing ?? null,
      rawPrice:      String(row.price),
      rawCurrency:   supplier.currency,
      parsedPrice:   row.price,
      parsedCurrency: supplier.currency,
      // Use aiSuggestedProductName to store category from PDF — helps admin pick right category on approval
      aiSuggestedProductName: row.category ?? null,
      stagingStatus: 'pending_review',
    }))

    await prisma.supplierPriceStaging.createMany({ data: stagingData })

    await prisma.supplierPriceFile.update({
      where: { id: priceFile.id },
      data: {
        importStatus:      'completed',
        totalRowsDetected: rows.length,
        rowsExtracted:     rows.length,
        rowsFailed:        0,
        processedAt:       new Date(),
      },
    })

    return Response.json({
      fileId:       priceFile.id,
      extracted:    rows.length,
      stagingCount: rows.length,
    }, { status: 201 })

  } catch (err) {
    // Mark file as failed but don't delete — admin can see it failed
    await prisma.supplierPriceFile.update({
      where: { id: priceFile.id },
      data:  { importStatus: 'failed', processedAt: new Date() },
    }).catch(() => null)

    const msg = err instanceof Error ? err.message : 'Extraction failed'
    return Response.json({ error: msg }, { status: 500 })
  }
}
