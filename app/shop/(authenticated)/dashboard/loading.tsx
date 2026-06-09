export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 pb-24 animate-pulse">
      {/* Hero skeleton */}
      <div className="bg-green-800 px-4 pt-8 pb-16">
        <div className="max-w-3xl mx-auto">
          <div className="h-7 w-48 bg-green-700 rounded-lg mb-2" />
          <div className="h-4 w-36 bg-green-700 rounded-lg mb-3" />
          <div className="h-5 w-28 bg-green-700 rounded-full" />
        </div>
      </div>
      {/* Cards skeleton */}
      <div className="max-w-3xl mx-auto px-4 -mt-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="h-3 bg-gray-200 rounded w-2/3 mb-2" />
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-1" />
              <div className="h-2.5 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
      {/* Body skeleton */}
      <div className="max-w-3xl mx-auto px-4 mt-6 space-y-5">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-full mb-2" />
            <div className="h-3 bg-gray-100 rounded w-4/5" />
          </div>
        ))}
      </div>
    </div>
  )
}
