import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { assertCompanyAccess } from '@/lib/authorization'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'

const AddItemSchema = z.object({
  productId:             z.string().uuid().optional(),
  supplierPriceVersionId: z.string().uuid().optional(),
  description:           z.string().min(1),
  brand:                 z.string().optional().nullable(),
  unit:                  z.string().optional().nullable(),
  qty:                   z.number().positive(),
  unitPrice:             z.number().positive().optional(),  // required if no productId
  marginPct:             z.number().optional(),
})

async function recalcTotals(quotationId: string, tx: Prisma.TransactionClient) {
  const items    = await tx.quotationItem.findMany({ where: { quotationId } })
  const subtotal = items.reduce((sum, i) => sum.plus(i.lineTotal), new Prisma.Decimal(0))
  await tx.quotation.update({
    where: { id: quotationId },
    data:  { subtotal, totalAmount: subtotal },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id }  = await params
  const body    = await request.json() as unknown
  const parsed  = AddItemSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const quotation = await prisma.quotation.findUnique({
    where:  { id },
    select: { id: true, status: true, companyId: true },
  })
  if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!['draft', 'pending_review'].includes(quotation.status)) {
    return Response.json({ error: 'Cannot edit a quotation in this status.' }, { status: 400 })
  }

  const denied = await assertCompanyAccess(quotation.companyId, session)
  if (denied) return denied

  const data = parsed.data

  let unitPrice:             Prisma.Decimal
  let unitCost:              Prisma.Decimal | null = null
  let marginPct:             Prisma.Decimal | null = null
  let resolvedSupplierPVId:  string | null         = data.supplierPriceVersionId ?? null

  if (data.productId) {
    // Auto-calculate from product pricing
    const [product, globalSetting] = await Promise.all([
      prisma.product.findUnique({
        where:   { id: data.productId, isActive: true },
        include: {
          category:      { select: { defaultMarginPct: true } },
          priceVersions: {
            where:   { isCurrent: true },
            orderBy: { approvedAt: 'desc' },
            take:    1,
            select:  { id: true, costPrice: true },
          },
        },
      }),
      prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
    ])

    if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

    if (data.unitPrice !== undefined) {
      // Salesperson override
      unitPrice = new Prisma.Decimal(data.unitPrice)
    } else if (product.priceVersions[0]) {
      const globalMargin = globalSetting?.value ?? '30'
      unitCost  = product.priceVersions[0].costPrice
      unitPrice = roundPrice(calculateSellingPrice(
        unitCost,
        product.defaultMarginPct,
        product.category.defaultMarginPct,
        globalMargin,
      ))
      resolvedSupplierPVId = resolvedSupplierPVId ?? product.priceVersions[0].id
    } else {
      return Response.json({ error: 'Product has no current price set.' }, { status: 422 })
    }

    if (unitCost) {
      marginPct = unitPrice.minus(unitCost).dividedBy(unitPrice).times(100)
    }
  } else {
    // Free-text item — unitPrice is required
    if (data.unitPrice === undefined) {
      return Response.json({ error: 'unitPrice is required for free-text items.' }, { status: 400 })
    }
    unitPrice = new Prisma.Decimal(data.unitPrice)
    if (data.marginPct !== undefined) {
      marginPct = new Prisma.Decimal(data.marginPct)
    }
  }

  const qty       = new Prisma.Decimal(data.qty)
  const lineTotal = unitPrice.times(qty)

  const item = await prisma.$transaction(async tx => {
    const maxOrder = await tx.quotationItem.aggregate({
      where:   { quotationId: id },
      _max:    { sortOrder: true },
    })
    const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1

    const newItem = await tx.quotationItem.create({
      data: {
        quotationId:            id,
        productId:              data.productId              ?? null,
        supplierPriceVersionId: resolvedSupplierPVId       ?? null,
        description:            data.description,
        brand:                  data.brand                 ?? null,
        unit:                   data.unit                  ?? null,
        qty,
        unitCost,
        unitPrice,
        marginPct,
        lineTotal,
        sortOrder,
      },
    })
    await recalcTotals(id, tx)
    return newItem
  })

  return Response.json({
    id:          item.id,
    description: item.description,
    brand:       item.brand,
    unit:        item.unit,
    qty:         item.qty.toString(),
    unitCost:    item.unitCost?.toString()  ?? null,
    unitPrice:   item.unitPrice.toString(),
    marginPct:   item.marginPct?.toString() ?? null,
    lineTotal:   item.lineTotal.toString(),
    sortOrder:   item.sortOrder,
  }, { status: 201 })
}
