const STRIP_SUFFIXES = [
  /\bsdn\.?\s*bhd\.?\b/gi,
  /\bsdg\.?\s*bhd\.?\b/gi,
  /\bpte\.?\s*ltd\.?\b/gi,
  /\bltd\.?\b/gi,
  /\binc\.?\b/gi,
  /\bcorp\.?\b/gi,
  /\bllc\.?\b/gi,
  /\bplc\.?\b/gi,
]

export function normalizeName(name: string): string {
  let n = name.toLowerCase()
  for (const re of STRIP_SUFFIXES) {
    n = n.replace(re, '')
  }
  // Remove all punctuation except spaces, then collapse whitespace
  n = n.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
  return n
}
