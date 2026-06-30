/**
 * QNE stock master data — Brands (StockClasses), Categories (StockCategories),
 * and Groups (StockGroups). These are QNE's OWN taxonomy, used by the 6,600+
 * existing products. New stock codes (Part A) MUST reuse these — never push the
 * shop's category slugs into QNE (that pollutes the accounting master data).
 *
 * Live counts (27 Jun 2026): 515 brands, 40 categories, 830 groups.
 *
 * Reads (fetch*) are safe to call any time the VPN is up.
 * Writes (create*) add a new master record to QNE — gate behind human approval.
 */

import { qneLogin, qneGet, qnePost } from '@/lib/qneClient'
import { prisma } from '@/lib/prisma'

export type QneBrand    = { id: string; classCode: string;    description: string | null; isActive: boolean }
export type QneCategory = { id: string; categoryCode: string; description: string | null; isActive: boolean }
export type QneGroup    = { id: string; groupCode: string;    description: string | null; isActive: boolean }

export type StockMasters = {
  brands:     QneBrand[]
  categories: QneCategory[]
  groups:     QneGroup[]
}

/** Same shape as StockMasters, plus base-UOM options — what the product form needs. */
export type StockMastersCached = StockMasters & { uoms: string[] }

/** Fetches all three master lists in parallel. Active records only, sorted by code. */
export async function fetchStockMasters(token?: string): Promise<StockMasters> {
  const tk = token ?? (await qneLogin())
  const [brands, categories, groups] = await Promise.all([
    qneGet<QneBrand[]>('/StockClasses', tk),
    qneGet<QneCategory[]>('/StockCategories', tk),
    qneGet<QneGroup[]>('/StockGroups', tk),
  ])

  const activeSorted = <T extends { isActive: boolean }>(rows: T[], code: (r: T) => string): T[] =>
    rows.filter(r => r.isActive).sort((a, b) => code(a).localeCompare(code(b)))

  return {
    brands:     activeSorted(brands,     b => b.classCode),
    categories: activeSorted(categories, c => c.categoryCode),
    groups:     activeSorted(groups,     g => g.groupCode),
  }
}

/**
 * Syncs QNE's stock taxonomy (brands/categories/groups) + a derived UOM list
 * into the qne_stock_masters DB cache so the New Product modal dropdowns work
 * WITHOUT the Radmin VPN. Requires VPN (reads live QNE). Admin-triggered.
 * UOMs are the distinct base units already on our products (VPN-free source).
 */
export async function syncQneStockMasters(): Promise<{ brands: number; categories: number; groups: number; uoms: number }> {
  const masters = await fetchStockMasters()   // live QNE — needs VPN

  const unitRows = await prisma.product.findMany({
    where:    { unit: { not: null } },
    distinct: ['unit'],
    select:   { unit: true },
  })
  const uoms = [...new Set(unitRows.map(u => (u.unit ?? '').trim().toUpperCase()).filter(Boolean))].sort()

  const rows = [
    ...masters.brands.map(b     => ({ type: 'brand',    code: b.classCode,    description: b.description })),
    ...masters.categories.map(c => ({ type: 'category', code: c.categoryCode, description: c.description })),
    ...masters.groups.map(g     => ({ type: 'group',    code: g.groupCode,    description: g.description })),
    ...uoms.map(u                => ({ type: 'uom',      code: u,              description: null as string | null })),
  ]

  // Replace-all: deleteMany + createMany (2 queries, pooler-friendly).
  await prisma.$transaction([
    prisma.qneStockMaster.deleteMany({}),
    prisma.qneStockMaster.createMany({ data: rows, skipDuplicates: true }),
  ])

  return { brands: masters.brands.length, categories: masters.categories.length, groups: masters.groups.length, uoms: uoms.length }
}

/**
 * Reads the cached stock masters from the DB — VPN-free, used by the product
 * form GET. Reconstructs the StockMasters shape the modal already expects.
 */
export async function fetchStockMastersCached(): Promise<StockMastersCached> {
  const rows = await prisma.qneStockMaster.findMany({ orderBy: { code: 'asc' } })
  return {
    brands:     rows.filter(r => r.type === 'brand').map(r    => ({ id: '', classCode: r.code,    description: r.description, isActive: true })),
    categories: rows.filter(r => r.type === 'category').map(r => ({ id: '', categoryCode: r.code, description: r.description, isActive: true })),
    groups:     rows.filter(r => r.type === 'group').map(r    => ({ id: '', groupCode: r.code,    description: r.description, isActive: true })),
    uoms:       rows.filter(r => r.type === 'uom').map(r => r.code),
  }
}

/** Creates a new brand (StockClass) in QNE. WRITE — requires human approval. */
export async function createBrand(classCode: string, description: string, token?: string): Promise<void> {
  const tk = token ?? (await qneLogin())
  await qnePost<unknown>('/StockClasses', tk, { classCode, description: description || classCode })
}

/** Creates a new category (StockCategory) in QNE. WRITE — requires human approval. */
export async function createCategory(categoryCode: string, description: string, token?: string): Promise<void> {
  const tk = token ?? (await qneLogin())
  await qnePost<unknown>('/StockCategories', tk, { categoryCode, description: description || categoryCode })
}

/** Creates a new group (StockGroup) in QNE. WRITE — requires human approval. */
export async function createGroup(groupCode: string, description: string, token?: string): Promise<void> {
  const tk = token ?? (await qneLogin())
  await qnePost<unknown>('/StockGroups', tk, { groupCode, description: description || groupCode })
}
