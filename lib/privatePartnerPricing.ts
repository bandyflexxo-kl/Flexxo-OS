/**
 * Private delivery-partner pricing (agreed rate card, KL).
 *
 * Two modes — parcels (boxes) and pallets — both priced PER TRIP.
 * For a multi-stop Delivery Run: distance = the FARTHEST stop (one trip price),
 * quantity = total boxes/pallets across all stops (Decision B, 28 Jun 2026).
 */

export type DeliveryMode = 'parcel' | 'pallet'

// ── Parcels: [near ≤30km, far >30km] × [1-5, 6-20, 21+ boxes] ─────────────────
const PARCEL = {
  near: { tier1: 20,  tier2: 100, tier3: 150 }, // 1–30 km
  far:  { tier1: 30,  tier2: 120, tier3: 180 }, // 31 km+
} as const

/** Price for a parcel trip — total boxes across stops, farthest-stop km. */
export function parcelTripPrice(totalBoxes: number, maxKm: number): number {
  const band = maxKm <= 30 ? PARCEL.near : PARCEL.far
  if (totalBoxes <= 5)  return band.tier1
  if (totalBoxes <= 20) return band.tier2
  return band.tier3
}

// ── Pallets: RM130 (1–50km) + RM30 per additional 50km band ──────────────────
/** Base price for ONE pallet at the given distance. Generalises the 1–450km table. */
export function palletBasePrice(maxKm: number): number {
  const band = Math.max(1, Math.ceil(maxKm / 50)) // 1–50→1, 51–100→2, …, 401–450→9
  return 130 + (band - 1) * 30                     // 130,160,190,…,370,(400,430…beyond table)
}

/**
 * Price for a pallet trip. Decision A (as-is): 1 pallet = base; N≥2 = base×1.5×(N−1).
 * (2 pallets @ 1–50km = 130×1.5×1 = RM195; 3 = 130×1.5×2 = RM390.)
 */
export function palletTripPrice(totalPallets: number, maxKm: number): number {
  const base = palletBasePrice(maxKm)
  if (totalPallets <= 1) return base
  return base * 1.5 * (totalPallets - 1)
}

/** Dispatcher — price a whole run by mode. `qty` = total boxes or total pallets. */
export function tripPrice(mode: DeliveryMode, qty: number, maxKm: number): number {
  return mode === 'pallet' ? palletTripPrice(qty, maxKm) : parcelTripPrice(qty, maxKm)
}
