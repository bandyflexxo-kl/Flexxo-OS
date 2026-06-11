export default function ActivitiesLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 bg-gray-200 rounded w-28" />
        <div className="h-9 bg-gray-200 rounded-lg w-32" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex gap-4">
            <div className="w-8 h-8 bg-gray-200 rounded-full shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <div className="h-3.5 bg-gray-200 rounded w-48" />
                <div className="h-3 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-64 mb-1.5" />
              <div className="h-2.5 bg-gray-100 rounded w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
