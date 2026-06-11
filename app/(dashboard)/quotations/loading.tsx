export default function QuotationsLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 bg-gray-200 rounded w-28" />
        <div className="h-9 bg-gray-200 rounded-lg w-36" />
      </div>
      <div className="flex gap-2 mb-5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-8 bg-gray-100 rounded-lg w-24" />
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-5 bg-gray-100 rounded-full w-20" />
            </div>
            <div className="h-3 bg-gray-100 rounded w-48 mb-1.5" />
            <div className="h-3 bg-gray-100 rounded w-36" />
          </div>
        ))}
      </div>
    </div>
  )
}
