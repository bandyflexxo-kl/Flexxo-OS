/**
 * Route-level skeleton for /shop/cart.
 * Shown immediately by Next.js App Router while the client component loads.
 * Matches the real cart layout: header + item rows + summary card.
 */
export default function CartLoading() {
  return (
    <div className="animate-pulse space-y-4 max-w-2xl">
      {/* Page title */}
      <div className="h-7 bg-gray-200 rounded-lg w-28" />

      {/* Item rows */}
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex gap-4 items-start">
          {/* Thumbnail */}
          <div className="w-16 h-16 bg-gray-100 rounded-xl shrink-0" />
          {/* Details */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
            <div className="h-5 bg-gray-200 rounded w-1/4 mt-1" />
          </div>
          {/* Qty control */}
          <div className="flex gap-1 shrink-0">
            <div className="w-7 h-7 bg-gray-100 rounded-lg" />
            <div className="w-7 h-7 bg-gray-100 rounded-lg" />
          </div>
        </div>
      ))}

      {/* Order summary card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="h-4 bg-gray-200 rounded w-36" />
        <div className="flex justify-between">
          <div className="h-3 bg-gray-100 rounded w-20" />
          <div className="h-3 bg-gray-200 rounded w-16" />
        </div>
        <div className="h-px bg-gray-100 w-full" />
        <div className="flex justify-between">
          <div className="h-4 bg-gray-200 rounded w-16" />
          <div className="h-4 bg-gray-200 rounded w-20" />
        </div>
        {/* CTA button */}
        <div className="h-12 bg-green-100 rounded-xl w-full mt-2" />
      </div>
    </div>
  )
}
