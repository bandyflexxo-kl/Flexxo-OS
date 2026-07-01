/**
 * English number-to-words for QNE-style document amount-in-words lines,
 * e.g. 1380      -> "MALAYSIAN RINGGIT ONE THOUSAND THREE HUNDRED EIGHTY ONLY"
 *      1844.60   -> "MALAYSIAN RINGGIT ONE THOUSAND EIGHT HUNDRED FORTY FOUR AND SIXTY SEN ONLY"
 */

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
]
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
const SCALES = ['', ' THOUSAND', ' MILLION', ' BILLION', ' TRILLION']

/** Words for 0..999 (no leading/trailing spaces). */
function chunkToWords(n: number): string {
  const parts: string[] = []
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`); n %= 100 }
  if (n >= 20)  { parts.push(TENS[Math.floor(n / 10)]); n %= 10 }
  if (n > 0)    { parts.push(ONES[n]) }
  return parts.join(' ')
}

/** Words for a non-negative integer. */
export function integerToWords(n: number): string {
  if (n === 0) return 'ZERO'
  const parts: string[] = []
  let scale = 0
  while (n > 0) {
    const c = n % 1000
    if (c) parts.unshift(chunkToWords(c) + SCALES[scale])
    n = Math.floor(n / 1000)
    scale++
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** "MALAYSIAN RINGGIT … [AND … SEN] ONLY" for a MYR amount. */
export function ringgitInWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  const ringgit = Math.floor(rounded)
  const sen     = Math.round((rounded - ringgit) * 100)
  let s = `MALAYSIAN RINGGIT ${integerToWords(ringgit)}`
  if (sen > 0) s += ` AND ${integerToWords(sen)} SEN`
  return `${s} ONLY`
}
