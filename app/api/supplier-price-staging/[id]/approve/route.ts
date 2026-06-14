import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const Schema = z.object({
  productName:  z.string().min(1, 'Product name is required.'),
  categoryId:   z.string().uuid('Category is required.'),
  brand:        z.string().optional(),
  unit:         z.string().optional(),
  price:        z.number().positive('Price must be a positive number.'),
  currency:     z.string().default('MYR'),
  moq:          z.number().int().positive().optional(),
  validUntil:   z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { id: stagingId } = await params
  const body = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const staging = await prisma.supplierPriceStaging.findUnique({ where: { id: stagingId } })
  if (!staging) return Response.json({ error: 'Staging row not found' }, { status: 404 })
  if (staging.stagingStatus !== 'pending_review') {
    return Response.json({ error: 'This row has already been reviewed.' }, { status: 409 })
  }

  const { productName, categoryId, brand, unit, price, currency, moq, validUntil } = parsed.data

  // Find or create the product
  let productId = staging.matchedProductId

  if (!productId) {
    // Check if product with same name already exists in this category
    const existing = await prisma.product.findFirst({
      where: {
        name:       { equals: productName, mode: 'insensitive' },
        categoryId,
      },
    })

    if (existing) {
      productId = existing.id
    } else {
      const newProduct = await prisma.product.create({
        data: {
          categoryId,
          name:        productName,
          brand:       brand || null,
          unit:        unit  || null,
          createdById: session.userId,
        },
      })
      productId = newProduct.id
    }
  }

  // Get next version number for this supplier+product combo
  const lastVersion = await prisma.supplierPriceVersion.findFirst({
    where:   { supplierId: staging.supplierId, productId },
    orderBy: { versionNumber: 'desc' },
    select:  { versionNumber: true },
  })
  const nextVersion = (lastVersion?.versionNumber ?? 0) + 1

  // Mark older versions as not current
  await prisma.supplierPriceVersion.updateMany({
    where: { supplierId: staging.supplierId, productId, isCurrent: true },
    data:  { isCurrent: false },
  })

  // Create the approved price version
  const priceVersion = await prisma.supplierPriceVersion.create({
    data: {
      supplierId:     staging.supplierId,
      productId,
      stagingRowId:   stagingId,
      versionNumber:  nextVersion,
      costPrice:      price,
      currency:       currency,
      minOrderQty:    moq ?? 1,
      unit:           unit || null,
      priceValidUntil: validUntil ? new Date(validUntil) : null,
      isCurrent:      true,
      sourceFileName: (await prisma.supplierPriceFile.findUnique({ where: { id: staging.fileId }, select: { fileName: true } }))?.fileName ?? null,
      approvedById:   session.userId,
      approvedAt:     new Date(),
    },
  })

  // Mark staging row as approved
  await prisma.supplierPriceStaging.update({
    where: { id: stagingId },
    data: {
      stagingStatus:   'approved',
      matchedProductId: productId,
      matchStatus:     'confirmed',
      reviewedById:    session.userId,
      reviewedAt:      new Date(),
    },
  })

  return Response.json({ ok: true, priceVersionId: priceVersion.id, productId })
}
