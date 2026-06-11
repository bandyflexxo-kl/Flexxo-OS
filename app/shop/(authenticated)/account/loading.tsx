/**
 * Route-level skeleton for /shop/account.
 * Shown immediately while the client component hydrates and fetches profile.
 */
export default function AccountLoading() {
  return (
    <div className="animate-pulse space-y-5 max-w-lg">
      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-start gap-4">
          {/* Avatar circle */}
          <div className="w-14 h-14 rounded-full bg-gray-200 shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 bg-gray-200 rounded w-36" />
            <div className="h-3 bg-gray-100 rounded w-48" />
            <div className="h-5 bg-gray-100 rounded-md w-28 mt-1" />
          </div>
        </div>
        {/* Detail grid */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="space-y-1.5">
              <div className="h-2.5 bg-gray-100 rounded w-12" />
              <div className="h-4 bg-gray-200 rounded w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Change password card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div className="h-5 bg-gray-200 rounded w-44" />
        <div className="h-10 bg-gray-100 rounded-xl" />
        <div className="h-10 bg-gray-100 rounded-xl" />
        <div className="h-10 bg-gray-100 rounded-xl" />
        <div className="h-11 bg-green-100 rounded-xl" />
      </div>
    </div>
  )
}
