/**
 * Route-level skeleton for /shop/orders.
 * Shown immediately while the server component fetches order history.
 */
export default function OrdersLoading() {
  return (
    <div className="animate-pulse space-y-5">
      {/* Page title */}
      <div className="h-7 bg-gray-200 rounded-lg w-32" />

      {/* Order rows */}
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          {/* Top row: order ref + status */}
          <div className="flex items-center justify-between">
            <div className="h-4 bg-gray-200 rounded w-32" />
            <div className="h-6 bg-gray-100 rounded-full w-24" />
          </div>
          {/* Progress stepper */}
          <div className="flex items-center gap-1 mt-1">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className="flex-1 h-1.5 bg-gray-100 rounded-full" />
            ))}
          </div>
          {/* Bottom: date + amount */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="h-3 bg-gray-100 rounded w-24" />
            <div className="h-4 bg-gray-200 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
