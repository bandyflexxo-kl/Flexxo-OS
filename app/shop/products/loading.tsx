/**
 * Route-level loading UI for /shop/products.
 * Shown by Next.js App Router as soon as navigation begins,
 * while the server component (fetching categories) is running.
 * Once the server component resolves, this is replaced by the
 * real page — which then shows the skeleton while client-side
 * product data loads.
 */
export default function ShopProductsLoading() {
  return (
    <div className="flex gap-6 lg:gap-8 animate-pulse">
      {/* Sidebar skeleton */}
      <aside className="w-44 lg:w-48 shrink-0 animate-pulse space-y-1.5">
        <div className="h-3 bg-gray-200 rounded-full w-24 mb-3" />
        {Array.from({ length: 13 }).map((_, i) => (
          <div key={i} className="h-9 bg-gray-100 rounded-lg" />
        ))}
      </aside>

      {/* Main skeleton */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Search bar skeleton */}
        <div className="h-11 bg-gray-100 rounded-xl animate-pulse" />
        {/* Count line */}
        <div className="h-4 bg-gray-100 rounded-full w-32 animate-pulse" />
        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
              <div className="aspect-square bg-gray-100" />
              <div className="p-4 space-y-2.5">
                <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
                <div className="h-3.5 bg-gray-100 rounded-full w-full" />
                <div className="h-3.5 bg-gray-100 rounded-full w-3/4" />
                <div className="h-5 bg-gray-100 rounded-full w-2/5 mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
