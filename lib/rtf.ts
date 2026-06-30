/**
 * lib/rtf.ts — minimal RTF → plain-text extractor.
 *
 * QNE stores some line-item descriptions (notably "service"/SVC lines, whose
 * `description` field is just ".") as an RTF blob in the line's `note` field
 * (DevExpress Office File API). We only need the visible text, so this walks the
 * RTF with a brace-depth state machine, skipping non-content destination groups
 * (fonttbl/colortbl/stylesheet/info/\* ignorables) and decoding \'hh escapes.
 */

const DESTINATIONS = new Set([
  'fonttbl', 'filetbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable',
  'revtbl', 'rsidtbl', 'generator', 'info', 'pict', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'wgrffmtfilter', 'xmlnstbl', 'mmathPr', 'fldinst',
])

// Control words that should render as a space (paragraph/line/cell breaks).
const BREAKS = new Set(['par', 'line', 'tab', 'cell', 'row', 'sect', 'page'])

export function rtfToPlainText(input: string | null | undefined): string {
  const s = input ?? ''
  if (!s.includes('\\rtf')) return s.trim()   // not RTF — return as-is

  let out = ''
  let i = 0
  const n = s.length
  const skipStack: boolean[] = []
  let skipping = false

  while (i < n) {
    const ch = s[i]

    if (ch === '{') { skipStack.push(skipping); i++; continue }
    if (ch === '}') { skipping = skipStack.pop() ?? false; i++; continue }

    if (ch === '\\') {
      // Control word: \word, optionally a numeric param, optionally one trailing space
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 64))
      if (m) {
        if (DESTINATIONS.has(m[1])) skipping = true
        else if (!skipping && BREAKS.has(m[1])) out += ' '
        i += m[0].length
        continue
      }
      // Control symbol
      const sym = s[i + 1]
      if (sym === "'") {                                   // \'hh hex escape
        const hex = s.slice(i + 2, i + 4)
        if (!skipping) out += String.fromCharCode(parseInt(hex, 16) || 32)
        i += 4
        continue
      }
      if (sym === '*') { skipping = true; i += 2; continue }   // \* ignorable destination
      if (!skipping && (sym === '\\' || sym === '{' || sym === '}' || sym === '~')) out += sym === '~' ? ' ' : sym
      i += 2
      continue
    }

    if (ch === '\r' || ch === '\n') { i++; continue }
    if (!skipping) out += ch
    i++
  }

  return out.replace(/\s+/g, ' ').trim()
}
