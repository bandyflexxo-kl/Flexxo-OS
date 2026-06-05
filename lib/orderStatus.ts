// ── Internal pipeline statuses (full 6-step flow) ───────────────────────────
export const ORDER_STATUSES = [
  'Confirmed',   // order created from accepted quotation
  'Approved',    // admin approved, invoice issued, warehouse task created
  'Picking',     // warehouse is picking items
  'Packed',      // warehouse done, awaiting Lalamove booking
  'Delivering',  // Lalamove booked, driver on the way
  'Delivered',   // delivered, Google Review link sent
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

// ── Status colours for CRM UI ────────────────────────────────────────────────
export const STATUS_COLORS: Record<string, string> = {
  Confirmed:  'bg-blue-100 text-blue-700',
  Approved:   'bg-indigo-100 text-indigo-700',
  Picking:    'bg-yellow-100 text-yellow-700',
  Packed:     'bg-orange-100 text-orange-700',
  Delivering: 'bg-purple-100 text-purple-700',
  Delivered:  'bg-green-100 text-green-700',
  // Legacy (keep for backward compat with any existing records)
  Processing: 'bg-yellow-100 text-yellow-700',
  Shipped:    'bg-purple-100 text-purple-700',
}

// ── Map internal status → simplified 4-step status for B2B portal ─────────
export function toPortalStatus(internal: string): string {
  const map: Record<string, string> = {
    Confirmed:  'Confirmed',
    Approved:   'Processing',
    Picking:    'Processing',
    Packed:     'Processing',
    Delivering: 'Shipped',
    Delivered:  'Delivered',
    // Legacy
    Processing: 'Processing',
    Shipped:    'Shipped',
  }
  return map[internal] ?? internal
}

// ── KL time-window check for Lalamove booking ────────────────────────────────
// Windows (KL = UTC+8): 10:00–11:30 and 13:45–16:00, Mon–Sat
export function isLalamoveBookingWindow(): boolean {
  const now = new Date()
  // Convert to KL time (UTC+8)
  const klTime  = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day     = klTime.getUTCDay()     // 0 = Sun, 6 = Sat
  const hour    = klTime.getUTCHours()
  const minute  = klTime.getUTCMinutes()
  const totalMins = hour * 60 + minute

  if (day === 0) return false // Sunday — no delivery

  const window1Start = 10 * 60        // 10:00
  const window1End   = 11 * 60 + 30  // 11:30
  const window2Start = 13 * 60 + 45  // 13:45
  const window2End   = 16 * 60        // 16:00

  return (totalMins >= window1Start && totalMins < window1End) ||
         (totalMins >= window2Start && totalMins < window2End)
}
