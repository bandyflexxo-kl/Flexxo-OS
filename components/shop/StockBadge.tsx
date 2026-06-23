/**
 * StockBadge — green/amber/gray stock status indicator.
 *
 * When `qty` is provided (QNE-synced stock count):
 *   qty > 10     → "X in stock"   (green)
 *   1–10         → "Only X left"  (amber)
 *   0            → "Out of Stock" (red)
 *   null/undef   → fall back to `status` prop
 */

export type StockStatus = 'in-stock' | 'available' | 'contact-us'

const STATUS_CONFIG: Record<StockStatus, { label: string; dot: string; badge: string }> = {
  'in-stock':   { label: '✓ In Stock',         dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200'  },
  'available':  { label: '◎ Available',         dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200'  },
  'contact-us': { label: 'Contact for Stock',   dot: 'bg-gray-400',   badge: 'bg-gray-50  text-gray-600  border-gray-200'   },
}

export default function StockBadge({
  status = 'in-stock',
  size   = 'sm',
  qty,
}: {
  status?: StockStatus
  size?:   'xs' | 'sm'
  qty?:    number | null
}) {
  let label: string
  let dot:   string
  let badge: string

  if (qty !== null && qty !== undefined) {
    if (qty === 0) {
      label = 'Out of Stock'
      dot   = 'bg-red-400'
      badge = 'bg-red-50 text-red-600 border-red-200'
    } else if (qty <= 10) {
      label = `Only ${qty} left`
      dot   = 'bg-amber-400'
      badge = 'bg-amber-50 text-amber-700 border-amber-200'
    } else {
      label = `${qty} in stock`
      dot   = 'bg-green-500'
      badge = 'bg-green-50 text-green-700 border-green-200'
    }
  } else {
    const cfg = STATUS_CONFIG[status]
    label = cfg.label
    dot   = cfg.dot
    badge = cfg.badge
  }

  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${textSize} ${badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {label}
    </span>
  )
}
