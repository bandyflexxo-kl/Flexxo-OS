export default function CompaniesLoading() {
  return (
    <div>
      {/* Topbar skeleton */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-200 bg-white">
        <div className="h-6 bg-gray-100 rounded-lg w-28 animate-pulse" />
        <div className="h-9 bg-gray-100 rounded-lg w-32 animate-pulse" />
      </div>

      <div className="p-6 lg:p-8">
        {/* Filter bar skeleton */}
        <div className="flex gap-2 mb-6 animate-pulse">
          <div className="h-9 bg-gray-100 rounded-lg w-52" />
          <div className="h-9 bg-gray-100 rounded-lg w-32" />
          <div className="h-9 bg-gray-100 rounded-lg w-32" />
          <div className="h-9 bg-gray-100 rounded-lg w-28" />
        </div>

        {/* Table skeleton */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="flex gap-4 px-4 py-3 bg-gray-50 border-b border-gray-100 animate-pulse">
            {[180, 100, 80, 60, 100, 120, 80].map((w, i) => (
              <div key={i} className="h-3 bg-gray-200 rounded-full" style={{ width: w }} />
            ))}
          </div>
          {/* Rows */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 border-b border-gray-50 animate-pulse">
              <div className="h-4 bg-gray-100 rounded-full w-44" />
              <div className="h-4 bg-gray-100 rounded-full w-24 hidden lg:block" />
              <div className="h-5 bg-gray-100 rounded-full w-20" />
              <div className="h-5 bg-gray-100 rounded-full w-16 hidden md:block" />
              <div className="h-4 bg-gray-100 rounded-full w-24 hidden xl:block" />
              <div className="h-5 bg-gray-100 rounded-full w-28 hidden lg:block" />
              <div className="h-4 bg-gray-100 rounded-full w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
