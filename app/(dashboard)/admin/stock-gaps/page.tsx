import { verifySession } from '@/lib/session'
import Topbar from '@/components/layout/Topbar'
import Link from 'next/link'
import { getEmptyStockCategories } from '@/lib/categoryCoverage'

/**
 * /admin/stock-gaps
 * Lists active sub-categories that have products but zero customer-visible,
 * in-stock items left after the QNE stock gate. Helps management decide which
 * items to start keeping in stock (steer customers toward stocked brands).
 *
 * Admin / Manager / Director only.
 */
export default async function StockGapsPage() {
  const session = await verifySession()

  if (!['Admin', 'Manager', 'Director'].includes(session.role)) {
    return (
      <div>
        <Topbar title="Stock gaps" />
        <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
          <p className="text-sm text-gray-500">You don’t have access to this page.</p>
        </div>
      </div>
    )
  }

  const empties = await getEmptyStockCategories()

  // Group by parent for a readable list.
  const byParent = new Map<string, { parentName: string; rows: typeof empties }>()
  for (const e of empties) {
    const key = e.parentName ?? 'Uncategorised'
    if (!byParent.has(key)) byParent.set(key, { parentName: key, rows: [] })
    byParent.get(key)!.rows.push(e)
  }

  return (
    <div>
      <Topbar title="Stock gaps" />
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900">Empty sub-categories</h2>
          <p className="text-xs text-gray-500 mt-1">
            These sub-categories still hold products, but every item is hidden or out of stock in QNE,
            so customers see nothing under them. Decide with management which items to keep in stock.
          </p>
        </div>

        {empties.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-sm text-green-800">
            ✓ No empty sub-categories — every active sub-category has at least one in-stock product.
          </div>
        ) : (
          <div className="space-y-5">
            {[...byParent.values()].map(group => (
              <div key={group.parentName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <p className="text-sm font-semibold text-gray-900">{group.parentName}</p>
                </div>
                <ul className="divide-y divide-gray-100">
                  {group.rows.map(row => (
                    <li key={row.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-900">{row.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {row.totalProducts} product{row.totalProducts === 1 ? '' : 's'} in catalogue, none in stock
                        </p>
                      </div>
                      <Link
                        href="/admin/products"
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0 ml-4"
                      >
                        Manage products →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
