/**
 * Route-level skeleton for /shop/quotations.
 * Shown immediately while the server component fetches quotation data.
 */
export default function QuotationsLoading() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Page title */}
      <div className="h-7 bg-gray-200 rounded-lg w-40" />

      {/* Quotation rows */}
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          {/* Top row: ref + status badge */}
          <div className="flex items-center justify-between">
            <div className="h-4 bg-gray-200 rounded w-36" />
            <div className="h-6 bg-gray-100 rounded-full w-20" />
          </div>
          {/* Middle row: item count + date */}
          <div className="flex gap-4">
            <div className="h-3 bg-gray-100 rounded w-24" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
          {/* Bottom row: total + action */}
          <div className="flex items-center justify-between pt-1">
            <div className="h-5 bg-gray-200 rounded w-28" />
            <div className="h-8 bg-gray-100 rounded-xl w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
