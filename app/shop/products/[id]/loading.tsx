export default function ProductDetailLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
      {/* Back link */}
      <div className="h-4 bg-gray-200 rounded w-32 mb-6" />
      {/* Product image placeholder */}
      <div className="h-56 bg-gray-200 rounded-2xl mb-6" />
      {/* Name + brand */}
      <div className="h-6 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-32 mb-4" />
      {/* Price */}
      <div className="h-8 bg-gray-200 rounded w-28 mb-6" />
      {/* Add to cart area */}
      <div className="flex gap-3 mb-8">
        <div className="h-11 bg-gray-200 rounded-xl w-28" />
        <div className="h-11 bg-gray-200 rounded-xl flex-1" />
      </div>
      {/* Spec table */}
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-4 py-2 border-b border-gray-100">
            <div className="h-3 bg-gray-200 rounded w-24 shrink-0" />
            <div className="h-3 bg-gray-100 rounded flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}
