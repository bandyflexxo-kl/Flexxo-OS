// Bigram similarity (Dice coefficient) — fast and good for company names
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }

  const aBigrams = bigrams(a)
  const bBigrams = bigrams(b)
  let intersect = 0

  for (const [bg, count] of aBigrams) {
    const bCount = bBigrams.get(bg) ?? 0
    intersect += Math.min(count, bCount)
  }

  return (2 * intersect) / (a.length + b.length - 2)
}
