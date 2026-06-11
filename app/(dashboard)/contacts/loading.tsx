export default function ContactsLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 bg-gray-200 rounded w-24" />
        <div className="h-9 bg-gray-200 rounded-lg w-32" />
      </div>
      <div className="h-10 bg-gray-100 rounded-xl w-full mb-5" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
            <div className="w-9 h-9 bg-gray-200 rounded-full shrink-0" />
            <div className="flex-1">
              <div className="h-3.5 bg-gray-200 rounded w-36 mb-1.5" />
              <div className="h-3 bg-gray-100 rounded w-48" />
            </div>
            <div className="h-3 bg-gray-100 rounded w-24 hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
