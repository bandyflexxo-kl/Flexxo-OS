/**
 * StockBadge — green/amber/red stock status indicator.
 *
 * Condition 14: appears on product cards AND product detail pages.
 *
 * Stock status logic:
 *  in-stock      → product has price + visible  (green)
 *  available     → no price set (price on request) (amber)
 *  contact-us    → special order / not stocked   (red/gray)
 */

export type StockStatus = 'in-stock' | 'available' | 'contact-us'

const CONFIG: Record<StockStatus, { label: string; dot: string; badge: string }> = {
  'in-stock':   { label: '✓ In Stock',         dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200'  },
  'available':  { label: '◎ Available',         dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200'  },
  'contact-us': { label: 'Contact for Stock',   dot: 'bg-gray-400',   badge: 'bg-gray-50  text-gray-600  border-gray-200'   },
}

export default function StockBadge({
  status = 'in-stock',
  size   = 'sm',
}: {
  status?: StockStatus
  size?:   'xs' | 'sm'
}) {
  const { label, dot, badge } = CONFIG[status]
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${textSize} ${badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {label}
    </span>
  )
}
