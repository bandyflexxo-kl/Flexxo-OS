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

export type QneBrand    = { id: string; classCode: string;    description: string | null; isActive: boolean }
export type QneCategory = { id: string; categoryCode: string; description: string | null; isActive: boolean }
export type QneGroup    = { id: string; groupCode: string;    description: string | null; isActive: boolean }

export type StockMasters = {
  brands:     QneBrand[]
  categories: QneCategory[]
  groups:     QneGroup[]
}

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
