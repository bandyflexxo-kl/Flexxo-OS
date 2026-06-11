export default function PipelineLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="h-7 bg-gray-200 rounded w-32 mb-6" />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3, 4, 5].map(col => (
          <div key={col} className="shrink-0 w-64">
            <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
            {[1, 2, 3].map(card => (
              <div key={card} className="bg-white rounded-xl border border-gray-100 p-4 mb-3 shadow-sm">
                <div className="h-3.5 bg-gray-200 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 rounded w-3/4 mb-3" />
                <div className="h-2.5 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
