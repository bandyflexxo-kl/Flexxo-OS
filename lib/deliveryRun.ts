/**
 * Private-partner delivery RUN helpers — pure (no DB), so they are easy to test and
 * safe to import anywhere. The API route does the Prisma work and calls these for
 * pricing + the WhatsApp job message.
 *
 * Pricing rule (Decision B, 28 Jun 2026): one trip priced by the FARTHEST stop —
 * distance = max(stop km), quantity = sum of boxes/pallets across all stops.
 */
import { tripPrice, type DeliveryMode } from '@/lib/privatePartnerPricing'

export type RunStopInput = {
  km:  number
  qty: number   // boxes (parcel) or pallets
}

/** Farthest-stop price for a whole run. */
export function priceRun(
  mode: DeliveryMode,
  stops: RunStopInput[],
): { maxKm: number; totalQty: number; price: number } {
  const maxKm    = stops.reduce((m, s) => Math.max(m, s.km || 0), 0)
  const totalQty = stops.reduce((n, s) => n + (s.qty || 0), 0)
  const price    = totalQty > 0 ? Math.round(tripPrice(mode, totalQty, maxKm) * 100) / 100 : 0
  return { maxKm, totalQty, price }
}

function unitWord(mode: DeliveryMode, n: number): string {
  const base = mode === 'pallet' ? 'pallet' : 'box'
  return n === 1 ? base : (mode === 'pallet' ? 'pallets' : 'boxes')
}

export type PartnerMessageStop = {
  company:      string
  doRef:        string | null      // QNE DO reference if pushed, else order ref
  address:      string
  contactName:  string | null
  contactPhone: string | null
  qty:          number
  items:        { name: string; qty: number }[]
}

/**
 * Builds the WhatsApp job text for the delivery partner group. Plain text with light
 * WhatsApp markdown (*bold*) — renders cleanly in a group chat.
 */
export function buildPartnerMessage(opts: {
  runCode:  string
  mode:     DeliveryMode
  maxKm:    number
  totalQty: number
  price:    number
  pickup:   string
  stops:    PartnerMessageStop[]
}): string {
  const { runCode, mode, totalQty, price, pickup, stops } = opts
  const L: string[] = []
  L.push(`🚚 *FLEXXO DELIVERY RUN ${runCode}*`)
  L.push(
    `${mode === 'pallet' ? 'Pallet' : 'Parcel'} · ${stops.length} stop${stops.length > 1 ? 's' : ''}` +
    ` · ${totalQty} ${unitWord(mode, totalQty)} · ~${opts.maxKm} km`,
  )
  L.push(`Partner fee: *RM ${price.toFixed(2)}*`)
  L.push(`📦 Pickup: ${pickup}`)
  L.push('')

  stops.forEach((s, i) => {
    L.push(`*${i + 1}) ${s.company}*${s.doRef ? `  (${s.doRef})` : ''}`)
    L.push(`📍 ${s.address}`)
    if (s.contactName || s.contactPhone) {
      L.push(`👤 ${[s.contactName, s.contactPhone].filter(Boolean).join(' · ')}`)
    }
    L.push(`📦 ${s.qty} ${unitWord(mode, s.qty)}`)
    if (s.items.length) {
      const shown = s.items.slice(0, 12).map(it => `   • ${it.qty}× ${it.name}`)
      L.push(...shown)
      if (s.items.length > 12) L.push(`   • …+${s.items.length - 12} more item(s)`)
    }
    L.push('')
  })

  L.push('Please chop/sign the DO at each stop. Thank you! 🙏')
  return L.join('\n')
}

/** Short human run code from a uuid, e.g. "RUN-4F2A9C". */
export function runCode(id: string): string {
  return 'RUN-' + id.replace(/-/g, '').slice(0, 6).toUpperCase()
}
