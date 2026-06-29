import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { calculateSellingPrice, roundPrice } from '@/lib/pricing'
import { Prisma } from '@/generated/prisma/client'
import { newStockSchema } from '@/lib/qneProductValidation'
import { checkStockDuplicates } from '@/lib/qneProductValidation'
import type { NewStockInput } from '@/lib/qneProductCreate'
import { QneUnavailableError } from '@/lib/qneClient'
import { buildStockCode, assembleStockName } from '@/lib/stockCodeGen'

export async function GET() {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin','Director'].includes(session.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [products, globalSetting] = await Promise.all([
    prisma.product.findMany({
      where:   { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true, defaultMarginPct: true } },
        priceVersions: {
          where:   { isCurrent: true },
          orderBy: { approvedAt: 'desc' },
          take:    1,
          select:  { costPrice: true, currency: true },
        },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'default_margin_pct' } }),
  ])

  const globalMargin = globalSetting?.value ?? '30'

  return Response.json(products.map(p => {
    const costPrice = p.priceVersions[0]?.costPrice ?? null
    const sellingPrice = costPrice
      ? roundPrice(calculateSellingPrice(costPrice, p.defaultMarginPct, p.category.defaultMarginPct, globalMargin))
      : null

    return {
      id:                   p.id,
      name:                 p.name,
      brand:                p.brand,
      unit:                 p.unit,
      internalSku:          p.internalSku,
      qneItemCode:          p.qneItemCode,
      category:             { id: p.category.id, name: p.category.name },
      catalogDescription:   p.catalogDescription,
      defaultMarginPct:     p.defaultMarginPct?.toString() ?? null,
      googleDrivePhotoId:   p.googleDrivePhotoId,
      isVisibleToCustomers: p.isVisibleToCustomers,
      costPrice:            costPrice?.toString() ?? null,
      sellingPrice:         sellingPrice?.toString() ?? null,
      currency:             p.priceVersions[0]?.currency ?? 'MYR',
    }
  }))
}

/**
 * Creates a new stock code in the CRM only (status `local_only`). The QNE write
 * is a SEPARATE, explicitly-approved step (POST /api/admin/products/[id]/push-to-qne)
 * so a product is never lost if QNE rejects it (SOP §A8).
 *
 * Body: newStockSchema fields + optional `acknowledgeDuplicate` (human reviewed
 * the QNE near-matches and confirmed this item is genuinely new).
 */
export async function POST(request: Request) {
  const session = await verifySession().catch(() => null)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['Admin', 'Director'].includes(session.role))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const acknowledgeDuplicate = raw.acknowledgeDuplicate === true
  const parsed = newStockSchema.safeParse(raw)
  if (!parsed.success)
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const d = parsed.data

  // Shop sub-category must exist (this is the CRM/website taxonomy, NOT QNE's).
  const shopCategory = await prisma.productCategory.findUnique({
    where:  { id: d.shopCategoryId },
    select: { id: true },
  })
  if (!shopCategory)
    return Response.json({ error: { shopCategoryId: ['Shop sub-category not found'] } }, { status: 400 })

  // SOP: stock code = [BRAND]-[supplierModel], system-assembled (brand prefix
  // enforced, uppercased, symbols stripped). The product name follows in SOP order.
  const stockCode = buildStockCode(d.brand, d.supplierModel)
  const stockName = assembleStockName({
    brand:       d.brand,
    code:        stockCode,
    description: d.nameDescription,
    identity:    d.nameIdentity,
    size:        d.nameSize,
    color:       d.nameColor,
    packing:     d.namePacking,
  })

  // Duplicate gate (SOP §A6) — hard-block an exact CRM code collision; for an
  // exact QNE-code match require explicit human acknowledgement.
  try {
    const dup = await checkStockDuplicates(stockCode, stockName)
    if (dup.codeInCrm)
      return Response.json({ error: { stockCode: ['This code already exists in the CRM catalogue'] } }, { status: 409 })
    if (dup.codeInQne && !acknowledgeDuplicate)
      return Response.json({ error: 'CODE_EXISTS_IN_QNE', duplicate: dup }, { status: 409 })
  } catch (err) {
    if (err instanceof QneUnavailableError)
      return Response.json({ error: 'QNE unreachable — connect the Radmin VPN to validate the code, then retry.' }, { status: 503 })
    throw err
  }

  // Freeze the exact payload the QNE push will send (lets the retry button re-send).
  const pushPayload: NewStockInput = {
    stockCode,
    stockName,
    baseUOM:       d.baseUOM,
    category:      d.category,
    group:         d.group,
    brand:         d.brand,
    listPrice:     d.listPrice,
    purchasePrice: d.purchasePrice,
    ...(d.minPrice      !== undefined ? { minPrice: d.minPrice } : {}),
    ...(d.barcode       ? { barCode: d.barcode } : {}),
    ...(d.description    ? { description: d.description } : {}),
    ...(d.outputTaxCode ? { outputTaxCode: d.outputTaxCode } : {}),
    ...(d.remarks?.length   ? { remarks: d.remarks } : {}),
    ...(d.extraUoms?.length ? { extraUoms: d.extraUoms } : {}),
  }

  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, false)`

  const product = await prisma.product.create({
    data: {
      name:                 stockName,
      brand:                d.brand,
      unit:                 d.baseUOM,
      qneItemCode:          stockCode,
      barcode:              d.barcode ?? null,
      catalogDescription:   d.description ?? null,
      categoryId:           d.shopCategoryId,
      qneCategory:          d.category,
      qneGroup:             d.group,
      customSellingPrice:   new Prisma.Decimal(String(d.listPrice)),
      isActive:             true,
      isVisibleToCustomers: false,
      qnePushStatus:        'local_only',
      qnePushPayload:       pushPayload as unknown as Prisma.InputJsonValue,
      createdById:          session.userId,
    },
    select: { id: true, name: true, qneItemCode: true, qnePushStatus: true },
  })

  return Response.json({ ok: true, product }, { status: 201 })
}
