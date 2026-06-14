/**
 * lib/lalamoveBooking.ts
 * Smart booking time (avoid lunch + after-hours) + surge detection.
 * KL = UTC+8, no DST — safe to use fixed offset.
 */

const KL_OFFSET_MS = 8 * 60 * 60 * 1000

function toKL(d: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const kl = new Date(d.getTime() + KL_OFFSET_MS)
  return {
    year:    kl.getUTCFullYear(),
    month:   kl.getUTCMonth() + 1,
    day:     kl.getUTCDate(),
    hour:    kl.getUTCHours(),
    minute:  kl.getUTCMinutes(),
    weekday: kl.getUTCDay(), // 0=Sun, 6=Sat
  }
}

/** Build a UTC Date for a specific KL wall-clock time (KL = +08:00, no DST). */
function klAt(year: number, month: number, day: number, hour: number, minute: number): Date {
  const p = (n: number) => String(n).padStart(2, '0')
  return new Date(`${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00+08:00`)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000)
}

export type BookingTimeResult = {
  scheduleAt:  Date
  isScheduled: boolean
  label:       string  // shown to admin in the confirm panel
}

/**
 * Returns the best Lalamove pickup time given KL business rules:
 *  - 11:45–14:00 KL → defer to 14:15 (lunch break)
 *  - ≥ 17:00 KL    → defer to next business day 09:00
 *  - Weekend       → defer to Monday 09:00
 *  - Otherwise     → immediate (now + 15 min buffer)
 */
export function getSmartBookingTime(now = new Date()): BookingTimeResult {
  const kl = toKL(now)
  const { year, month, day, hour, minute, weekday } = kl

  // ── Weekend ────────────────────────────────────────────────────────────────
  if (weekday === 0 || weekday === 6) {
    const daysToMonday = weekday === 0 ? 1 : 2
    const mon   = addDays(now, daysToMonday)
    const monKl = toKL(mon)
    return {
      scheduleAt:  klAt(monKl.year, monKl.month, monKl.day, 9, 0),
      isScheduled: true,
      label:       'Monday 9:00 AM — next business day',
    }
  }

  // ── After hours (17:00+) ───────────────────────────────────────────────────
  if (hour >= 17) {
    const daysAhead = weekday === 5 ? 3 : 1  // Fri→Mon, else +1 day
    const next   = addDays(now, daysAhead)
    const nextKl = toKL(next)
    return {
      scheduleAt:  klAt(nextKl.year, nextKl.month, nextKl.day, 9, 0),
      isScheduled: true,
      label:       weekday === 5 ? 'Monday 9:00 AM — after hours + weekend' : 'Tomorrow 9:00 AM — after hours',
    }
  }

  // ── Lunch + near-lunch (11:45–14:00) ──────────────────────────────────────
  const nearLunch = (hour === 11 && minute >= 45) || (hour >= 12 && hour < 14)
  if (nearLunch) {
    return {
      scheduleAt:  klAt(year, month, day, 14, 15),
      isScheduled: true,
      label:       'Today 2:15 PM — skipping lunch break (12–2 PM)',
    }
  }

  // ── Normal business hours → immediate ─────────────────────────────────────
  return {
    scheduleAt:  new Date(now.getTime() + 15 * 60 * 1000), // 15-min Lalamove minimum
    isScheduled: false,
    label:       'Now — immediate pickup',
  }
}

// ── Surge detection ───────────────────────────────────────────────────────────

/** Baseline prices for KL deliveries (MYR). Flag if >40% above these. */
const BASELINES: Record<string, number> = {
  MOTORCYCLE: 15,
  MPV:        45,
  VAN:        65,
}

export type SurgeResult = {
  isSurge:     boolean
  baselineMyr: number
  label:       string   // e.g. "RM 72.00 (normal ~RM 45)"
}

export function checkSurge(serviceType: string, priceMyr: number): SurgeResult {
  const baseline = BASELINES[serviceType] ?? 0
  const isSurge  = baseline > 0 && priceMyr > baseline * 1.4
  return {
    isSurge,
    baselineMyr: baseline,
    label:       `RM ${priceMyr.toFixed(2)} (normal ~RM ${baseline.toFixed(0)})`,
  }
}
