/**
 * FlexxoSpinner — branded loading indicator.
 *
 * Sizes:
 *   xs / sm / md / lg  — inline spinner (button, row, badge)
 *   page               — full centered block with Flexxo branding
 *                        (use inside loading.tsx or empty-state containers)
 *
 * Accessible: role="status" + aria-label on every variant.
 */
export default function FlexxoSpinner({
  size  = 'md',
  color = 'green',
  label,
}: {
  size?:  'xs' | 'sm' | 'md' | 'lg' | 'page'
  color?: 'green' | 'white'
  /** Optional text shown below the page variant */
  label?: string
}) {
  /* ── Page-level centered spinner ──────────────────────────────────────── */
  if (size === 'page') {
    return (
      <div
        role="status"
        aria-label={label ?? 'Loading…'}
        className="flex flex-col items-center justify-center gap-4 py-20"
      >
        {/* Dual-ring branded spinner */}
        <div className="relative w-12 h-12">
          {/* Outer ring — slow */}
          <span className="absolute inset-0 rounded-full border-[3px] border-green-100 border-t-green-600 animate-spin" style={{ animationDuration: '1s' }} />
          {/* Inner ring — faster, offset */}
          <span className="absolute inset-[6px] rounded-full border-2 border-green-50 border-t-green-400 animate-spin" style={{ animationDuration: '0.65s', animationDirection: 'reverse' }} />
          {/* Centre dot */}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </span>
        </div>

        {/* Brand wordmark */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-green-700 font-extrabold text-sm tracking-widest uppercase select-none">
            Flexxo
          </span>
          {label && (
            <span className="text-gray-400 text-xs">{label}</span>
          )}
        </div>
      </div>
    )
  }

  /* ── Inline spinner ────────────────────────────────────────────────────── */
  const sizeClass: Record<string, string> = {
    xs: 'w-3 h-3 border-[1.5px]',
    sm: 'w-3.5 h-3.5 border-[1.5px]',
    md: 'w-4 h-4 border-2',
    lg: 'w-5 h-5 border-2',
  }
  const colorClass =
    color === 'white'
      ? 'border-white/40 border-t-white'
      : 'border-green-200 border-t-green-600'

  return (
    <span
      role="status"
      aria-label="Loading…"
      className={`inline-block rounded-full animate-spin shrink-0 ${sizeClass[size]} ${colorClass}`}
    />
  )
}
