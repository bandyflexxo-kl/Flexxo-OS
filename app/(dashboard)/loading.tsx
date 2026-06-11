export default function DashboardLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-16 mb-1" />
            <div className="h-2.5 bg-gray-100 rounded w-20" />
          </div>
        ))}
      </div>
      {/* Content rows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="h-4 bg-gray-200 rounded w-32 mb-4" />
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" />
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4 mb-1.5" />
                  <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
