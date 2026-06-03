import 'server-only'
import { Prisma } from '@/app/generated/prisma/client'

/**
 * Calculates the selling price from supplier cost using a margin percentage.
 *
 * Margin hierarchy (first non-null wins):
 *   1. product.defaultMarginPct  (per-product override)
 *   2. category.defaultMarginPct (per-category default)
 *   3. globalMarginPct           (system-wide default from SystemSetting)
 *
 * Formula: sellingPrice = costPrice × (1 + margin / 100)
 */
export function calculateSellingPrice(
  costPrice:      Prisma.Decimal,
  productMargin:  Prisma.Decimal | null,
  categoryMargin: Prisma.Decimal | null,
  globalMarginPct: string,   // raw string from SystemSetting.value
): Prisma.Decimal {
  const margin =
    productMargin ??
    categoryMargin ??
    new Prisma.Decimal(globalMarginPct)

  return costPrice.times(new Prisma.Decimal(1).plus(margin.dividedBy(100)))
}

/**
 * Calculates the retail (guest) price from supplier cost.
 * Uses ONE global retail margin only — no product/category overrides.
 * This ensures admin can change all retail prices in one shot via settings.
 *
 * Formula: retailPrice = costPrice × (1 + retailMarginPct / 100)
 */
export function calculateRetailPrice(
  costPrice:       Prisma.Decimal,
  retailMarginPct: string,   // raw string from SystemSetting 'retail_margin_pct'
): Prisma.Decimal {
  return costPrice.times(new Prisma.Decimal(1).plus(new Prisma.Decimal(retailMarginPct).dividedBy(100)))
}

/**
 * Rounds a Decimal to 2 decimal places (standard currency rounding).
 */
export function roundPrice(price: Prisma.Decimal): Prisma.Decimal {
  return price.toDecimalPlaces(2)
}
