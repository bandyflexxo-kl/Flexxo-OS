/**
 * KL / Selangor delivery zones for the private-partner rate card.
 *
 * Each zone carries a representative ONE-WAY distance (km) from the Flexxo warehouse
 * (Lot 2772F, 47000 Sungai Buloh / Shah Alam). When an admin compiles a delivery run
 * the system suggests a zone from the customer's postcode, but the admin CONFIRMS or
 * overrides it per stop — so these are sensible defaults, not exact routing.
 *
 * The chosen km feeds `lib/privatePartnerPricing` (parcel near/far split at 30 km;
 * pallet 50 km bands). Match is longest-prefix-wins, so a specific 5-digit prefix
 * beats a 2-digit one (e.g. 47100 → Puchong overrides 47 → Shah Alam).
 */

export type DeliveryZone = {
  id:       string
  label:    string
  km:       number      // representative one-way km from the warehouse
  prefixes: string[]    // postcode prefixes, matched longest-first
}

export const DELIVERY_ZONES: DeliveryZone[] = [
  { id: 'sg-buloh',  label: 'Sungai Buloh / Kepong',      km: 8,  prefixes: ['47000', '52', '68100'] },
  { id: 'shah-alam', label: 'Shah Alam / Subang / USJ',   km: 16, prefixes: ['40', '475', '476'] },
  { id: 'pj',        label: 'Petaling Jaya',              km: 18, prefixes: ['46', '473', '474', '478'] },
  { id: 'puchong',   label: 'Puchong / Seri Kembangan',   km: 28, prefixes: ['471', '43300'] },
  { id: 'klang',     label: 'Klang / Port Klang',         km: 32, prefixes: ['41', '42'] },
  { id: 'kl-city',   label: 'Kuala Lumpur (city)',        km: 26, prefixes: ['50', '53', '54', '55', '57', '58', '59', '60'] },
  { id: 'cheras',    label: 'Cheras / Ampang',            km: 30, prefixes: ['56', '68'] },
  { id: 'gombak',    label: 'Gombak / Selayang / Rawang', km: 24, prefixes: ['48'] },
  { id: 'kajang',    label: 'Kajang / Bangi / Semenyih',  km: 40, prefixes: ['43'] },
  { id: 'cyber',     label: 'Cyberjaya / Putrajaya',      km: 42, prefixes: ['62', '63'] },
  { id: 'sepang',    label: 'Sepang / KLIA / Banting',    km: 55, prefixes: ['64', '439'] },
]

/** Sentinel for "none of the above — admin types the km by hand". */
export const CUSTOM_ZONE: DeliveryZone = { id: 'custom', label: 'Other (enter km)', km: 0, prefixes: [] }

/** Best-guess zone for a Malaysian postcode (longest matching prefix), or null. */
export function zoneForPostcode(postcode: string | null | undefined): DeliveryZone | null {
  const pc = (postcode ?? '').replace(/\D/g, '')
  if (!pc) return null
  let best: DeliveryZone | null = null
  let bestLen = 0
  for (const z of DELIVERY_ZONES) {
    for (const p of z.prefixes) {
      if (pc.startsWith(p) && p.length > bestLen) { best = z; bestLen = p.length }
    }
  }
  return best
}

export function zoneById(id: string): DeliveryZone | null {
  if (id === CUSTOM_ZONE.id) return CUSTOM_ZONE
  return DELIVERY_ZONES.find(z => z.id === id) ?? null
}

/** All zones plus the custom sentinel — for the admin's zone dropdown. */
export function zoneOptions(): DeliveryZone[] {
  return [...DELIVERY_ZONES, CUSTOM_ZONE]
}
