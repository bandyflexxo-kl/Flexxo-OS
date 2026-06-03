import Link from 'next/link'

type ProductCardProps = {
  id:           string
  name:         string
  brand:        string | null
  unit:         string | null
  categoryName: string
  sellingPrice: string | null
  currency:     string
  hasPhoto:     boolean
}

export default function ProductCard({
  id, name, brand, unit, categoryName, sellingPrice, currency, hasPhoto,
}: ProductCardProps) {
  return (
    <Link
      href={`/shop/products/${id}`}
      className="group bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all overflow-hidden flex flex-col"
    >
      {/* Photo */}
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        {hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/portal/photo/${id}`}
            alt={name}
            className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-gray-200">
            📦
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-1 flex-1">
        <p className="text-xs text-blue-600 font-medium">{categoryName}</p>
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-blue-700 transition-colors">{name}</p>
        {brand && <p className="text-xs text-gray-500">{brand}</p>}
        {unit  && <p className="text-xs text-gray-400">{unit}</p>}
        <div className="mt-auto pt-2 border-t border-gray-50">
          {sellingPrice ? (
            <p className="text-base font-bold text-gray-900">
              {currency} {Number(sellingPrice).toFixed(2)}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">Price on request</p>
          )}
        </div>
      </div>
    </Link>
  )
}
