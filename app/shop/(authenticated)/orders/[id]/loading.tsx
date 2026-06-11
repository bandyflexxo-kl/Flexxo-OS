export default function OrderDetailLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
      {/* Back link */}
      <div className="h-4 bg-gray-200 rounded w-24 mb-6" />
      {/* Status stepper */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-200 rounded-full" />
            {i < 4 && <div className="h-1 bg-gray-100 rounded flex-1 w-12" />}
          </div>
        ))}
      </div>
      {/* Order summary card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm mb-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex justify-between py-2.5 border-b border-gray-50 last:border-0">
            <div className="h-3 bg-gray-200 rounded w-48" />
            <div className="h-3 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
      {/* Total */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex justify-between">
        <div className="h-4 bg-gray-200 rounded w-16" />
        <div className="h-4 bg-gray-200 rounded w-24" />
      </div>
    </div>
  )
}
