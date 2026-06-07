/**
 * FlexxoSpinner — branded loading indicator.
 * Replaces all raw `animate-spin` instances in shop pages.
 * Accessible: includes role="status" + aria-label.
 */
export default function FlexxoSpinner({
  size  = 'md',
  color = 'green',
}: {
  size?:  'xs' | 'sm' | 'md' | 'lg'
  color?: 'green' | 'white'
}) {
  const sizeClass: Record<string, string> = {
    xs: 'w-3 h-3 border-[1.5px]',
    sm: 'w-3.5 h-3.5 border-[1.5px]',
    md: 'w-4 h-4 border-2',
    lg: 'w-5 h-5 border-2',
  }
  const colorClass =
    color === 'white'
      ? 'border-white border-t-transparent'
      : 'border-green-500 border-t-transparent'

  return (
    <span
      role="status"
      aria-label="Loading…"
      className={`inline-block rounded-full animate-spin shrink-0 ${sizeClass[size]} ${colorClass}`}
    />
  )
}
