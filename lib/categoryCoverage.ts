/**
 * lib/categoryCoverage.ts
 * Finds active leaf sub-categories that have NO customer-visible, in-stock
 * products left after the stock gate is applied.
 *
 * Surfaced to admins (TodoSection + /admin/stock-gaps) so management can decide
 * which items to start keeping in stock — supporting the "steer customers toward
 * stocked brands" goal.
 *
 * The visibility rule mirrors lib/products-api.ts queryProducts():
 *   isActive && isVisibleToCustomers && (qneAvailableQty is null OR > 0)
 * i.e. an empty sub-category here means every product in it is either hidden or
 * synced to 0 stock.
 */

import { prisma } from '@/lib/prisma'

export type EmptyCategory = {
  id:         string
  name:       string
  parentId:   string | null
  parentName: string | null
  totalProducts: number   // active products in the category, regardless of stock
}

/**
 * Returns active leaf sub-categories (parentCategoryId set) that hold at least
 * one active product but zero customer-visible, in-stock products.
 *
 * A leaf with no products at all is excluded — "went empty" is about losing
 * sellable stock, not categories that were always empty.
 */
export async function getEmptyStockCategories(): Promise<EmptyCategory[]> {
  const leaves = await prisma.productCategory.findMany({
    where:  { isActive: true, parentCategoryId: { not: null } },
    select: {
      id:               true,
      name:             true,
      parentCategoryId: true,
      parentCategory:   { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  })

  const result: EmptyCategory[] = []

  for (const leaf of leaves) {
    const [totalProducts, visibleInStock] = await Promise.all([
      prisma.product.count({ where: { categoryId: leaf.id, isActive: true } }),
      prisma.product.count({
        where: {
          categoryId:           leaf.id,
          isActive:             true,
          isVisibleToCustomers: true,
          OR: [{ qneAvailableQty: null }, { qneAvailableQty: { gt: 0 } }],
        },
      }),
    ])

    if (totalProducts > 0 && visibleInStock === 0) {
      result.push({
        id:            leaf.id,
        name:          leaf.name,
        parentId:      leaf.parentCategoryId,
        parentName:    leaf.parentCategory?.name ?? null,
        totalProducts,
      })
    }
  }

  return result
}

/** Lightweight count for the admin todo badge. */
export async function countEmptyStockCategories(): Promise<number> {
  return (await getEmptyStockCategories()).length
}
