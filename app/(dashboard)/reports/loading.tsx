export default function ReportsLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="h-7 bg-gray-200 rounded w-40 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-20 mb-1" />
            <div className="h-2.5 bg-gray-100 rounded w-16" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-4 py-2.5 border-b border-gray-50 last:border-0">
            <div className="h-3 bg-gray-200 rounded flex-1" />
            <div className="h-3 bg-gray-100 rounded w-16" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
