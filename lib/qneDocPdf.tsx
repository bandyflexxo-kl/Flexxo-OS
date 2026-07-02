// NOTE: no `import 'server-only'` here — the golden-render script
// (scripts/renderDocSamples.ts) imports this lib under tsx, where that guard
// throws. Server-only usage is still enforced in practice by the `fs` import,
// which cannot be bundled into client components.
import { readFileSync } from 'fs'
import { join } from 'path'
import { Document, Page, View, Text, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

/**
 * QNE-style document PDFs (Quotation / Sales Order / Delivery Order / Invoice),
 * generated in-house because QNE's own Reports/PDF endpoint is broken server-side
 * (FileHelpers assembly load failure — re-confirmed 30 Jun 2026).
 *
 * Each doc type is a MEASUREMENT-DRIVEN replica of Flexxo's real QNE printout,
 * extracted with PyMuPDF (fonts, sizes, band colors, column x-positions):
 *   - QT : ref "QT KL2604/0075 Lavish"          — A4 portrait, b/w, centred title.
 *   - SO : ref "SO KL2606/0136 TROPICANA"       — A4 LANDSCAPE picking sheet:
 *          no letterhead, Bill/Ship boxes, Pick/Check/Deliver grid, checkboxes,
 *          green table header, Picked column, Stock Balance (red when short).
 *   - DO : ref "DO KL2607/0001 TROPICANA"       — 595x792 portrait letterhead,
 *          green meta band, price-less table, green Total Qty band, stamp +
 *          recipient signature.
 *   - INV: ref "INV KL2606/00137 AF IOI KULAI"  — A4 portrait, green Bill/Ship
 *          bands, per-line discount, amount-in-words green band, notes box +
 *          totals, stamp + 3 signature rules, yellow e-Invoice band (+QR).
 * Originals archived in docs/pdf-originals/. Golden renders: scripts/renderDocSamples.ts.
 *
 * Font notes: QNE prints in Tahoma (embedded below). The originals also use
 * Tahoma-Italic (Reg. lines), ArialBlack (SO "Bill To:") and MicrosoftSansSerif
 * (INV notes) — all substituted with Tahoma regular/bold; indistinguishable ≤10pt.
 */

// ── Embed Tahoma (the real QNE report font) ──────────────────────────────────
Font.register({
  family: 'Tahoma',
  fonts: [
    { src: join(process.cwd(), 'public', 'fonts', 'tahoma.ttf') },
    { src: join(process.cwd(), 'public', 'fonts', 'tahomabd.ttf'), fontWeight: 'bold' },
  ],
})

// QNE never hyphenates — long words (KLEENEX TISSUE3PLY50S) wrap at word
// boundaries only. react-pdf's default splitter inserts "-" mid-word.
Font.registerHyphenationCallback(word => [word])

// ── Brand constants (measured from the originals) ────────────────────────────
const GREEN    = '#458e3b'   // header bands, rules, INVOICE word
const ZEBRA    = '#edebe0'   // DO + INV zebra stripe
const ZEBRA_SO = '#d7d7d7'   // SO zebra stripe
const YELLOW   = '#ffc000'   // INV e-Invoice band

// ── Static company details (from the real QNE printouts) ─────────────────────
const COMPANY = {
  name:    'FLEXXO (KL) SDN. BHD',
  regNo:   'Reg. 202201004348 (1450045-P)',
  tinNo:   'TIN No.: C29716437060',
  address: 'No. 1, Jalan TPP 6/8, Taman Perindustrian Puchong, 47100 Puchong, Selangor.',
  tel:     'Tel :+60 11-55898115 / +60 11-55808115',
  email:   'Email: order@kl.flexxo.com.my',
  emailPlain: 'order@kl.flexxo.com.my',
  bankPayee: 'FLEXXO (KL) SDN. BHD.',
  bankAcct:  'Public Bank Bhd A/C No. 3236557300',
  // INV header rows — the company's own billing / delivering addresses
  billToLines:       ['NO. 1, JALAN TPP 6/8, TAMAN PERINDUSTRIAN PUCHONG,', 'SELANGOR.'],
  deliveringToLines: ['LOT 2772F, JALAN INDUSTRI 12, KAMPUNG BARU SUNGAI', 'BULOH, 47000 SHAH ALAM, SELANGOR.', 'TEL: +60 11-5589 8115 / +60 11-5580 8115'],
}

export type QneDocType = 'QT' | 'SO' | 'DO' | 'INV'

const DOC_TITLE: Record<QneDocType, string> = {
  QT: 'Quotation', SO: 'Sales Order', DO: 'Delivery Order', INV: 'Invoice',
}

export type QneDocItem = {
  code:        string
  description: string
  subLines?:   string[]      // bullet/spec lines under the description
  qty:         number
  uom:         string
  unitPrice?:  number
  amount?:     number
  discount?:   number
  netAmount?:  number
  // SO picking-sheet extras
  barcode?:      string | null
  location?:     string | null
  stockBalance?: number | null   // rendered red when < qty (short stock)
}

export type QneShipTo = {
  name?:        string | null
  addressLines: string[]
  attn?:        string | null
  tel?:         string | null
  tel2?:        string | null
  fax?:         string | null
  tin?:         string | null
}

export type QneDocPdfData = {
  docType:       QneDocType
  docNo:         string       // "QT KL2604/0075" / "SO KL2606/0136" / …
  referenceNo?:  string | null
  terms?:        string | null
  date:          string       // "22/04/2026" (SO may include time: "26/06/2026   04:16 PM")
  agent?:        string | null
  page?:         string       // "1 of 1"
  customer:      { name: string; addressLines: string[]; tel?: string | null }
  items:         QneDocItem[]
  amountInWords?: string
  subTotal?:     number
  roundingAdj?:  number
  totalDiscount?: number
  netTotal?:     number
  currency?:     string
  validity?:     string | null
  deliveryTerm?: string | null
  priceNote?:    string | null
  // ── SO / DO / INV extras (all optional — QT callers unaffected) ──
  customerAttn?: string | null
  customerTel2?: string | null
  customerFax?:  string | null
  customerTin?:  string | null
  customerCode?: string | null   // QNE account e.g. "700-T008"
  salesman?:     string | null   // "BANDY" / "SALES 6"
  locationLabel?: string | null  // SO meta "Location" e.g. "STORE"
  shipTo?:       QneShipTo | null
  yourPoNo?:     string | null   // INV "Your P.O. No."
  orderNo?:      string | null   // INV: source DO no · DO: source SO no
  totalQty?:     number | null   // DO green band (computed from items when absent)
  eInvoice?:     { status?: string | null; uid?: string | null; validatedAt?: string | null; qrDataUrl?: string | null } | null
}

// ── Shared helpers ────────────────────────────────────────────────────────────

let logoDataUrl: string | null | undefined
function getLogo(): string | null {
  if (logoDataUrl !== undefined) return logoDataUrl
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'flexxo-logo.png'))
    logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`
  } catch { logoDataUrl = null }
  return logoDataUrl
}

let stampDataUrl: string | null | undefined
function getStamp(): string | null {
  if (stampDataUrl !== undefined) return stampDataUrl
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'flexxo-stamp.png'))
    stampDataUrl = `data:image/png;base64,${buf.toString('base64')}`
  } catch { stampDataUrl = null }
  return stampDataUrl
}

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "MALAYSIAN RINGGIT ONE THOUSAND NINETY ONLY" — QNE's amount-in-words line. */
export function myrAmountInWords(n: number): string {
  const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
    'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
  const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
  function below1000(x: number): string {
    const parts: string[] = []
    if (x >= 100) { parts.push(ONES[Math.floor(x / 100)], 'HUNDRED'); x %= 100 }
    if (x >= 20)  { parts.push(TENS[Math.floor(x / 10)]); x %= 10 }
    if (x > 0)    parts.push(ONES[x])
    return parts.join(' ')
  }
  function words(x: number): string {
    if (x === 0) return 'ZERO'
    const parts: string[] = []
    const millions  = Math.floor(x / 1_000_000)
    const thousands = Math.floor((x % 1_000_000) / 1000)
    const rest      = x % 1000
    if (millions)  parts.push(below1000(millions), 'MILLION')
    if (thousands) parts.push(below1000(thousands), 'THOUSAND')
    if (rest)      parts.push(below1000(rest))
    return parts.join(' ')
  }
  const int   = Math.floor(n)
  const cents = Math.round((n - int) * 100)
  let out = `MALAYSIAN RINGGIT ${words(int)}`
  if (cents > 0) out += ` AND CENTS ${words(cents)}`
  return out + ' ONLY'
}

/** Small empty checkbox (SO picking sheet). */
const Checkbox = ({ size = 7 }: { size?: number }) => (
  <View style={{ width: size, height: size, borderWidth: 0.8, borderColor: '#000' }} />
)

// ═══════════════════════════════════════════════════════════════════════════════
// QT — Quotation (original measured layout — UNCHANGED, user-approved)
// ═══════════════════════════════════════════════════════════════════════════════

// Exact column widths in points. Sum = 533 (content width).
const COLS = { no: 16, code: 55, desc: 222, qty: 27, uom: 35, price: 42, amt: 44, disc: 49, net: 43 }

const styles = StyleSheet.create({
  page: { flexDirection: 'column', paddingTop: 20, paddingBottom: 22, paddingLeft: 20, paddingRight: 42, fontSize: 8, color: '#000', fontFamily: 'Tahoma' },

  // Header — logo left, company block LEFT-aligned starting at x≈173
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  logo:      { width: 118, height: 40, objectFit: 'contain' },
  coBlock:   { flex: 1, marginLeft: 35 },
  coName:    { fontSize: 16, fontWeight: 'bold' },
  coLine:    { fontSize: 8, marginTop: 1.5 },
  hr:        { borderBottomWidth: 1, borderBottomColor: '#000', marginTop: 6 },

  title:     { fontSize: 14, fontWeight: 'bold', textAlign: 'center', marginTop: 8, marginBottom: 10 },

  // Customer + meta
  topRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  custCol:   { flex: 1, marginLeft: 7 },
  custName:  { fontSize: 9, fontWeight: 'bold', marginBottom: 5 },
  custLine:  { fontSize: 10, marginBottom: 2 },
  metaBox:   { width: 183 },
  metaRow:   { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: '46%', fontSize: 10 },
  metaValue: { width: '54%', fontSize: 10 },

  // Item table
  tbl:       { marginTop: 14, borderTopWidth: 1, borderTopColor: '#000' },
  th:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', paddingTop: 3, paddingBottom: 3, fontSize: 8 },
  tr:        { flexDirection: 'row', paddingTop: 5, fontSize: 7.5 },
  desc:      { fontSize: 8, marginTop: 1 },
  subLine:   { fontSize: 8, marginTop: 0.5 },

  amountWords: { marginTop: 0, marginBottom: 6, fontSize: 9 },

  // Bottom: notes + totals
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between' },
  notesCol:  { flex: 1, marginRight: 16 },
  noteLine:  { fontSize: 8, marginBottom: 2 },
  noteSmall: { flexDirection: 'row', fontSize: 7.5, marginBottom: 2 },
  totalsBox: { width: 198 },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, fontWeight: 'bold', marginBottom: 3 },

  // Footer
  thanks:    { marginTop: 16, fontSize: 8, lineHeight: 1.35 },
  signRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  signCell:  { width: '46%' },
  sign9:     { fontSize: 9 },
  signStamp: { fontSize: 10, textAlign: 'center', marginVertical: 6 },
  signRule:  { borderTopWidth: 0.8, borderTopColor: '#000', marginTop: 16, paddingTop: 2, fontSize: 9 },
})

function QtDocument({ data }: { data: QneDocPdfData }) {
  const logo = getLogo()
  const cur  = data.currency ?? 'MYR'

  const MetaRow = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, bold ? { fontWeight: 'bold' } : {}]}>{value}</Text>
    </View>
  )

  return (
    <Document title={data.docNo}>
      <Page size="A4" style={styles.page}>
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View>
            {logo
              ? <Image style={styles.logo} src={logo} />
              : <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1f9d55' }}>FLEXXO®</Text>}
          </View>
          <View style={styles.coBlock}>
            <Text style={styles.coName}>{COMPANY.name}</Text>
            <Text style={styles.coLine}>{COMPANY.address}</Text>
            <Text style={styles.coLine}>{COMPANY.tel}</Text>
            <Text style={styles.coLine}>{COMPANY.email}</Text>
          </View>
        </View>
        <View style={styles.hr} />

        {/* ── Title ────────────────────────────────────────────── */}
        <Text style={styles.title}>{DOC_TITLE[data.docType]}</Text>

        {/* ── Customer + meta ──────────────────────────────────── */}
        <View style={styles.topRow}>
          <View style={styles.custCol}>
            <Text style={styles.custName}>{data.customer.name}</Text>
            {data.customer.addressLines.map((l, i) => <Text key={i} style={styles.custLine}>{l}</Text>)}
            {data.customer.tel ? <Text style={styles.custLine}>{data.customer.tel}</Text> : null}
          </View>
          <View style={styles.metaBox}>
            <MetaRow label="No."           value={data.docNo} bold />
            <MetaRow label="Reference No." value={data.referenceNo ?? ''} />
            <MetaRow label="Terms"         value={data.terms ?? ''} />
            <MetaRow label="Date"          value={data.date} />
            <MetaRow label="Agent"         value={data.agent ?? ''} />
            <MetaRow label="Page"          value={data.page ?? '1 of 1'} />
          </View>
        </View>

        {/* ── Item table ───────────────────────────────────────── */}
        <View style={styles.tbl}>
          <View style={styles.th}>
            <Text style={{ width: COLS.no }}>#</Text>
            <Text style={{ width: COLS.code }}>CODE</Text>
            <Text style={{ width: COLS.desc }}>DESCRIPTION</Text>
            <Text style={{ width: COLS.qty, textAlign: 'right' }}>QTY</Text>
            <Text style={{ width: COLS.uom, textAlign: 'center' }}>UOM</Text>
            <Text style={{ width: COLS.price, textAlign: 'right' }}>U. PRICE</Text>
            <Text style={{ width: COLS.amt, textAlign: 'right' }}>AMOUNT</Text>
            <Text style={{ width: COLS.disc, textAlign: 'right' }}>DISCOUNT{'\n'}AMOUNT</Text>
            <Text style={{ width: COLS.net, textAlign: 'right' }}>NET AMT.</Text>
          </View>

          {data.items.map((it, i) => (
            <View key={i} style={{ paddingBottom: 7 }} wrap={false}>
              <View style={styles.tr}>
                <Text style={{ width: COLS.no }}>{i + 1}</Text>
                <Text style={{ width: COLS.code }}>{it.code}</Text>
                <Text style={{ width: COLS.desc }}>{it.description}</Text>
                <Text style={{ width: COLS.qty, textAlign: 'right' }}>{it.qty}</Text>
                <Text style={{ width: COLS.uom, textAlign: 'center' }}>{it.uom}</Text>
                <Text style={{ width: COLS.price, textAlign: 'right' }}>{money(it.unitPrice)}</Text>
                <Text style={{ width: COLS.amt, textAlign: 'right' }}>{money(it.amount)}</Text>
                <Text style={{ width: COLS.disc, textAlign: 'right' }}>{it.discount ? money(it.discount) : ''}</Text>
                <Text style={{ width: COLS.net, textAlign: 'right' }}>{money(it.netAmount ?? it.amount)}</Text>
              </View>
              {it.subLines?.length ? (
                <View style={{ marginLeft: COLS.no + COLS.code }}>
                  {it.subLines.map((s, j) => <Text key={j} style={styles.subLine}>{s}</Text>)}
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* spacer — absorbs free space so the footer block always sits at the page bottom */}
        <View style={{ flexGrow: 1, minHeight: 14 }} />

        {/* ── Amount in words + full-width rule under it ───────── */}
        {data.amountInWords ? (
          <View>
            <Text style={styles.amountWords}>{data.amountInWords}</Text>
            <View style={{ borderBottomWidth: 0.8, borderBottomColor: '#000', marginBottom: 6 }} />
          </View>
        ) : null}

        {/* ── Notes + Totals ───────────────────────────────────── */}
        <View style={styles.bottomRow}>
          <View style={styles.notesCol}>
            <Text style={styles.noteLine}>
              Note:  1. All cheques should be crossed and made payable to{' '}
              <Text style={{ fontWeight: 'bold' }}>{COMPANY.bankPayee}</Text>  {COMPANY.bankAcct}
            </Text>
            <View style={styles.noteSmall}>
              <Text style={{ width: 72 }}>Validity</Text><Text style={{ width: 8 }}>:</Text>
              <Text style={{ flex: 1 }}>{data.validity ?? ''}</Text>
            </View>
            <View style={styles.noteSmall}>
              <Text style={{ width: 72 }}>Delivery Term</Text><Text style={{ width: 8 }}>:</Text>
              <Text style={{ flex: 1 }}>{data.deliveryTerm ?? 'Orders with ready stock will be shipped within 48 hours.'}</Text>
            </View>
            <View style={styles.noteSmall}>
              <Text style={{ width: 72 }}>Note</Text><Text style={{ width: 8 }}>:</Text>
              <Text style={{ flex: 1 }}>{data.priceNote ?? 'Prices are subject to change without prior notice.'}</Text>
            </View>
          </View>
          <View style={styles.totalsBox}>
            <View style={styles.totRow}><Text>SUB TOTAL</Text><Text>{money(data.subTotal)}</Text></View>
            <View style={styles.totRow}><Text>ROUNDING ADJ</Text><Text>{money(data.roundingAdj ?? 0)}</Text></View>
            <View style={styles.totRow}><Text>TOTAL DISCOUNT</Text><Text>{money(data.totalDiscount ?? 0)}</Text></View>
            <View style={styles.totRow}>
              <Text>NET TOTAL</Text>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ marginRight: 28 }}>{cur}</Text>
                <Text>{money(data.netTotal)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Footer ───────────────────────────────────────────── */}
        <Text style={styles.thanks}>
          We hope that our {DOC_TITLE[data.docType].toLowerCase()} is favourable to you and looking forward to receive your valued{'\n'}orders in due course. Thank and regards.
        </Text>
        <View style={styles.signRow}>
          <View style={styles.signCell}>
            <Text style={styles.sign9}>Yours faithfully,</Text>
            <Text style={styles.signStamp}>COMPUTER GENERATE{'\n'}NO SIGN ARE REQUIRED</Text>
            <Text style={styles.signRule}>Authorised Signature</Text>
          </View>
          <View style={styles.signCell}>
            <Text style={styles.sign9}>Confirmation Order</Text>
            <Text style={[styles.sign9, { marginTop: 5 }]}>Acknowledged by,</Text>
            <Text style={[styles.signRule, { marginTop: 30 }]}>Name:</Text>
            <Text style={[styles.sign9, { marginTop: 7 }]}>Designation:</Text>
            <Text style={[styles.sign9, { marginTop: 7 }]}>Date:</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DO — Delivery Order (595×792, letterhead + green bands, no prices)
// ═══════════════════════════════════════════════════════════════════════════════

// Meta band cell widths (pt) — sum 542 = content width (595 − 28 − 25).
const DO_META: { label: string; w: number; key: 'customerCode' | 'salesman' | 'orderNo' | 'referenceNo' | 'page' | 'docNo' | 'date' }[] = [
  { label: 'Customer Account', w: 72,  key: 'customerCode' },
  { label: 'Sales Executive',  w: 60,  key: 'salesman' },
  { label: 'Order No.',        w: 97,  key: 'orderNo' },
  { label: 'Reference No.',    w: 100, key: 'referenceNo' },
  { label: 'Page No',          w: 48,  key: 'page' },
  { label: 'D. Order No.',     w: 100, key: 'docNo' },
  { label: 'DATE',             w: 65,  key: 'date' },
]
const DO_COLS = { no: 15, code: 108, desc: 305, qty: 60, uom: 54 }

const doS = StyleSheet.create({
  page:     { flexDirection: 'column', paddingTop: 20, paddingBottom: 30, paddingLeft: 28, paddingRight: 25, fontSize: 8, color: '#000', fontFamily: 'Tahoma' },
  logo:     { width: 124, height: 49, objectFit: 'contain' },
  coName:   { fontSize: 16, fontWeight: 'bold' },
  coReg:    { fontSize: 7.9, marginLeft: 4, marginBottom: 2 },
  coLine:   { fontSize: 7.9, marginTop: 1.5 },
  greenRule:{ borderBottomWidth: 2.5, borderBottomColor: GREEN, marginTop: 5 },
  title:    { fontSize: 18, fontWeight: 'bold', marginTop: 14 },
  titleRule:{ borderBottomWidth: 1, borderBottomColor: '#000', marginTop: 3 },
  colLabel: { fontSize: 8, marginBottom: 5 },
  custName: { fontSize: 9, fontWeight: 'bold', marginBottom: 4 },
  custLine: { fontSize: 10, marginBottom: 2.5 },
  attnLine: { fontSize: 10, marginTop: 6 },
  metaCell:   { backgroundColor: GREEN, borderRightWidth: 0.7, borderRightColor: '#fff', paddingHorizontal: 3, justifyContent: 'center' },
  metaLabel:  { fontSize: 7, color: '#fff' },
  metaValue:  { fontSize: 9, color: '#fff', fontWeight: 'bold' },
  th:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', paddingVertical: 4, fontSize: 8, marginTop: 8 },
  tr:       { flexDirection: 'row', paddingVertical: 3.5, fontSize: 8, alignItems: 'center' },
  totBand:  { backgroundColor: GREEN, paddingVertical: 3, paddingHorizontal: 8, alignItems: 'flex-end' },
  totLabel: { fontSize: 7, color: '#fff' },
  totValue: { fontSize: 9.8, color: '#fff', fontWeight: 'bold' },
  footLabel:{ fontSize: 9, marginTop: 12 },
  notesHead:{ fontSize: 8, marginTop: 8 },
  noteLine: { fontSize: 8, marginTop: 3, width: 330 },
  signRule: { borderTopWidth: 0.8, borderTopColor: '#000', paddingTop: 3, fontSize: 8, textAlign: 'center' },
  bottomGreen: { position: 'absolute', bottom: 12, left: 28, right: 25, borderBottomWidth: 2.5, borderBottomColor: GREEN },
})

function DoDocument({ data }: { data: QneDocPdfData }) {
  const logo  = getLogo()
  const stamp = getStamp()
  const totalQty = data.totalQty ?? data.items.reduce((s, it) => s + it.qty, 0)
  const metaValue = (key: typeof DO_META[number]['key']): string => {
    if (key === 'docNo') return data.docNo
    if (key === 'date')  return data.date
    if (key === 'page')  return data.page ?? '1 of 1'
    return (data[key] ?? '') as string
  }

  const AddressCol = ({ label, name, lines, attn, tel, fax }: { label: string; name?: string | null; lines: string[]; attn?: string | null; tel?: string | null; fax?: string | null }) => (
    <View style={{ width: '48%' }}>
      <Text style={doS.colLabel}>{label}</Text>
      {name ? <Text style={doS.custName}>{name}</Text> : null}
      {lines.map((l, i) => <Text key={i} style={doS.custLine}>{l}</Text>)}
      <Text style={doS.attnLine}>Attn : {attn ?? ''}</Text>
      <Text style={doS.custLine}>TEL : {tel ?? ''}</Text>
      <Text style={doS.custLine}>FAX : {fax ?? ''}</Text>
    </View>
  )

  return (
    <Document title={data.docNo}>
      <Page size={[595, 792]} style={doS.page}>
        {/* ── Letterhead ──────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {logo ? <Image style={doS.logo} src={logo} /> : null}
          <View style={{ flex: 1, marginLeft: 22, marginTop: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Text style={doS.coName}>{COMPANY.name}.</Text>
              <Text style={doS.coReg}>{COMPANY.regNo}</Text>
            </View>
            <Text style={doS.coLine}>{COMPANY.address}</Text>
            <Text style={doS.coLine}>{COMPANY.tel}</Text>
            <Text style={doS.coLine}>{COMPANY.email}</Text>
          </View>
        </View>
        <View style={doS.greenRule} />

        {/* ── Title ───────────────────────────────────────────── */}
        <Text style={doS.title}>Delivery Order</Text>
        <View style={doS.titleRule} />

        {/* ── Sold To / Ship To ───────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <AddressCol
            label="Sold To :" name={data.customer.name} lines={data.customer.addressLines}
            attn={data.customerAttn} tel={data.customer.tel} fax={data.customerFax}
          />
          <AddressCol
            label="Ship To :" name={data.shipTo?.name} lines={data.shipTo?.addressLines ?? data.customer.addressLines}
            attn={data.shipTo?.attn ?? data.customerAttn} tel={data.shipTo?.tel ?? data.customer.tel} fax={data.shipTo?.fax}
          />
        </View>

        {/* ── Green meta band ─────────────────────────────────── */}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          {DO_META.map((m, i) => (
            <View key={i} style={[doS.metaCell, { width: m.w, height: 13 }]}>
              <Text style={doS.metaLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row' }}>
          {DO_META.map((m, i) => (
            <View key={i} style={[doS.metaCell, { width: m.w, height: 15, borderTopWidth: 0.7, borderTopColor: '#fff' }]}>
              <Text style={doS.metaValue}>{metaValue(m.key)}</Text>
            </View>
          ))}
        </View>

        {/* ── Item table (no prices) ──────────────────────────── */}
        <View style={doS.th}>
          <Text style={{ width: DO_COLS.no }}>#</Text>
          <Text style={{ width: DO_COLS.code }}>CODE</Text>
          <Text style={{ width: DO_COLS.desc }}>DESCRIPTION</Text>
          <Text style={{ width: DO_COLS.qty, textAlign: 'right' }}>QTY</Text>
          <Text style={{ width: DO_COLS.uom, textAlign: 'right' }}>UOM</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={[doS.tr, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
            <Text style={{ width: DO_COLS.no }}>{i + 1}</Text>
            <Text style={{ width: DO_COLS.code }}>{it.code}</Text>
            <Text style={{ width: DO_COLS.desc }}>{it.description}</Text>
            <Text style={{ width: DO_COLS.qty, textAlign: 'right' }}>{it.qty}</Text>
            <Text style={{ width: DO_COLS.uom, textAlign: 'right' }}>{it.uom}</Text>
          </View>
        ))}

        <View style={{ flexGrow: 1, minHeight: 10 }} />

        {/* ── Total Qty band ──────────────────────────────────── */}
        <View style={doS.totBand}>
          <Text style={doS.totLabel}>Total Qty</Text>
          <Text style={doS.totValue}>{totalQty}</Text>
        </View>

        {/* ── Footer ──────────────────────────────────────────── */}
        <Text style={doS.footLabel}>Delivery Term:</Text>
        <Text style={doS.notesHead}>Notes:</Text>
        <Text style={doS.noteLine}>
          1. Goods sold are neither returnable nor refundable. Otherwise{'\n'}    a cancellation fee 20% on purchase price will be imposed.
        </Text>

        {/* Signature strip — stamp centred over "Authorised Signature" */}
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          <View style={{ width: '30%' }} />
          <View style={{ width: '34%', alignItems: 'center' }}>
            {stamp ? <Image style={{ width: 74, height: 74, marginBottom: -14 }} src={stamp} /> : <View style={{ height: 60 }} />}
            <View style={{ alignSelf: 'stretch' }}>
              <Text style={doS.signRule}>Authorised Signature</Text>
            </View>
          </View>
          <View style={{ width: '6%' }} />
          <View style={{ width: '30%', justifyContent: 'flex-end' }}>
            <Text style={doS.signRule}>Recipient&apos;s Chop and Signature</Text>
          </View>
        </View>

        <View style={doS.bottomGreen} fixed />
      </Page>
    </Document>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// INV — Invoice (A4 portrait, green bands, e-Invoice section)
// ═══════════════════════════════════════════════════════════════════════════════

// Column widths (pt) — sum 549 = content width (595 − 24 − 22).
const INV_COLS = { no: 15, code: 78, desc: 190, qty: 34, uom: 32, price: 45, amt: 52, disc: 50, net: 53 }

const invS = StyleSheet.create({
  page:     { flexDirection: 'column', paddingTop: 20, paddingBottom: 26, paddingLeft: 24, paddingRight: 22, fontSize: 8, color: '#000', fontFamily: 'Tahoma' },
  logo:     { width: 118, height: 46, objectFit: 'contain' },
  coName:   { fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  coReg:    { fontSize: 8 },
  hdrLabel: { width: 62, fontSize: 7 },
  hdrValue: { flex: 1, fontSize: 7 },
  invWord:  { fontSize: 15, fontWeight: 'bold', color: GREEN },
  metaLabel:{ width: 78, fontSize: 10 },
  metaValue:{ flex: 1, fontSize: 10 },
  band:     { backgroundColor: GREEN, height: 17, justifyContent: 'center', paddingLeft: 6 },
  bandText: { color: '#fff', fontSize: 10 },
  custName: { fontSize: 9, fontWeight: 'bold', marginTop: 5, marginBottom: 3 },
  custLine: { fontSize: 8.2, marginBottom: 2.5 },
  kvLine:   { flexDirection: 'row', fontSize: 8, marginBottom: 2 },
  th:       { flexDirection: 'row', backgroundColor: GREEN, paddingVertical: 4, paddingHorizontal: 1, alignItems: 'center' },
  thText:   { color: '#fff', fontSize: 8 },
  thSmall:  { color: '#fff', fontSize: 7, textAlign: 'right' },
  tr:       { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 1, fontSize: 8 },
  wordsBand:{ backgroundColor: GREEN, paddingVertical: 3.5, paddingLeft: 6, marginTop: 4 },
  wordsText:{ color: '#fff', fontSize: 9.5 },
  notesBox: { borderWidth: 0.8, borderColor: '#000', padding: 6, width: 335 },
  noteRow:  { flexDirection: 'row', fontSize: 8, marginBottom: 2 },
  totRow:   { flexDirection: 'row', justifyContent: 'space-between', fontSize: 10, marginBottom: 5 },
  netRule:  { borderBottomWidth: 0.8, borderBottomColor: '#000', width: 78, alignSelf: 'flex-end' },
  signLabel:{ borderTopWidth: 0.8, borderTopColor: '#000', paddingTop: 3, fontSize: 9, textAlign: 'center' },
  eiBand:   { backgroundColor: YELLOW, width: 250, paddingVertical: 3, paddingLeft: 6, marginTop: 8 },
  eiTitle:  { fontSize: 8, fontWeight: 'bold' },
  eiRow:    { flexDirection: 'row', fontSize: 8, marginTop: 3 },
  bottomGreen: { position: 'absolute', bottom: 10, left: 24, right: 22, borderBottomWidth: 2.5, borderBottomColor: GREEN },
})

function InvDocument({ data }: { data: QneDocPdfData }) {
  const logo  = getLogo()
  const stamp = getStamp()
  const words = data.amountInWords ?? (data.netTotal != null ? myrAmountInWords(data.netTotal) : null)

  const MetaRow = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <View style={{ flexDirection: 'row', marginBottom: 2.5 }}>
      <Text style={invS.metaLabel}>{label}</Text>
      <Text style={[invS.metaValue, bold ? { fontWeight: 'bold', fontSize: 9 } : {}]}>{value}</Text>
    </View>
  )
  const Kv = ({ k, v, kw = 26 }: { k: string; v: string; kw?: number }) => (
    <View style={invS.kvLine}><Text style={{ width: kw }}>{k}</Text><Text style={{ flex: 1 }}>{v}</Text></View>
  )

  return (
    <Document title={data.docNo}>
      <Page size="A4" style={invS.page}>
        {/* ── Header: company block left · meta right ─────────── */}
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 300 }}>
            {logo ? <Image style={invS.logo} src={logo} /> : null}
            <Text style={invS.coName}>{COMPANY.name}.</Text>
            <View style={{ flexDirection: 'row', marginTop: 1, marginBottom: 3 }}>
              <Text style={invS.coReg}>{COMPANY.regNo.replace(/\s+/g, '')}</Text>
              <Text style={[invS.coReg, { marginLeft: 14 }]}>{COMPANY.tinNo}</Text>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 1.5 }}>
              <Text style={invS.hdrLabel}>BILL TO:</Text>
              <View style={{ flex: 1 }}>{COMPANY.billToLines.map((l, i) => <Text key={i} style={{ fontSize: 7 }}>{l}</Text>)}</View>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 1.5 }}>
              <Text style={invS.hdrLabel}>DELIVERING TO:</Text>
              <View style={{ flex: 1 }}>{COMPANY.deliveringToLines.map((l, i) => <Text key={i} style={{ fontSize: 7 }}>{l}</Text>)}</View>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={invS.hdrLabel}>EMAIL:</Text>
              <Text style={{ flex: 1, fontSize: 7 }}>{COMPANY.emailPlain}</Text>
            </View>
          </View>
          <View style={{ flex: 1, marginLeft: 12, marginTop: 4 }}>
            <MetaRow label="Invoice No." value={data.docNo} bold />
            <MetaRow label="Date"        value={data.date} />
            <MetaRow label="Your P.O. No." value={data.yourPoNo ?? ''} />
            <MetaRow label="Order No."   value={data.orderNo ?? ''} />
            <MetaRow label="Salesman"    value={data.salesman ?? ''} />
            <MetaRow label="Terms"       value={data.terms ?? ''} />
            <MetaRow label="Account No." value={data.customerCode ?? ''} />
            <MetaRow label="Location"    value={data.locationLabel ?? ''} />
            <MetaRow label="Page"        value={data.page ?? '1 of 1'} />
          </View>
          <Text style={[invS.invWord, { position: 'absolute', top: 2, right: 0, width: 80, textAlign: 'right' }]}>INVOICE</Text>
        </View>

        {/* ── Bill To / Ship To green bands + customer blocks ─── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View style={{ width: 251 }}>
            <View style={invS.band}><Text style={invS.bandText}>Bill To:</Text></View>
            <Text style={invS.custName}>{data.customer.name}</Text>
            {data.customer.addressLines.map((l, i) => <Text key={i} style={invS.custLine}>{l}</Text>)}
            {data.customerTin ? <Kv k="TIN NO.:" v={data.customerTin} kw={40} /> : null}
            <View style={invS.kvLine}>
              <Text style={{ width: 26 }}>TEL:</Text>
              <Text style={{ width: 90 }}>{data.customer.tel ?? ''}</Text>
              <Text>TEL 2: {data.customerTel2 ?? ''}</Text>
            </View>
            <Kv k="ATTN:" v={data.customerAttn ?? ''} kw={32} />
          </View>
          <View style={{ width: 255 }}>
            <View style={invS.band}><Text style={invS.bandText}>Ship To:</Text></View>
            {data.shipTo?.name ? <Text style={invS.custName}>{data.shipTo.name}</Text> : <View style={{ height: 14 }} />}
            {(data.shipTo?.addressLines ?? data.customer.addressLines).map((l, i) => <Text key={i} style={invS.custLine}>{l}</Text>)}
            <View style={invS.kvLine}>
              <Text style={{ width: 26 }}>TEL:</Text>
              <Text style={{ width: 90 }}>{data.shipTo?.tel ?? data.customer.tel ?? ''}</Text>
              <Text>TEL 2: {data.shipTo?.tel2 ?? data.customerTel2 ?? ''}</Text>
            </View>
            <Kv k="ATTN:" v={data.shipTo?.attn ?? data.customerAttn ?? ''} kw={32} />
          </View>
        </View>

        {/* ── Item table ──────────────────────────────────────── */}
        <View style={[invS.th, { marginTop: 6 }]}>
          <Text style={[invS.thText, { width: INV_COLS.no }]}>#</Text>
          <Text style={[invS.thText, { width: INV_COLS.code }]}>CODE</Text>
          <Text style={[invS.thText, { width: INV_COLS.desc }]}>DESCRIPTION</Text>
          <Text style={[invS.thText, { width: INV_COLS.qty, textAlign: 'right' }]}>QTY</Text>
          <Text style={[invS.thText, { width: INV_COLS.uom, textAlign: 'right' }]}>UOM</Text>
          <Text style={[invS.thText, { width: INV_COLS.price, textAlign: 'right' }]}>U. PRICE</Text>
          <Text style={[invS.thText, { width: INV_COLS.amt, textAlign: 'right' }]}>AMOUNT</Text>
          <Text style={[invS.thSmall, { width: INV_COLS.disc }]}>Discount{'\n'}Amount</Text>
          <Text style={[invS.thText, { width: INV_COLS.net, textAlign: 'right' }]}>NET AMT.</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={[invS.tr, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
            <Text style={{ width: INV_COLS.no }}>{i + 1}</Text>
            <Text style={{ width: INV_COLS.code }}>{it.code}</Text>
            <View style={{ width: INV_COLS.desc }}>
              <Text>{it.description}</Text>
              {it.subLines?.map((s, j) => <Text key={j} style={{ marginTop: 1 }}>{s}</Text>)}
            </View>
            <Text style={{ width: INV_COLS.qty, textAlign: 'right' }}>{it.qty}</Text>
            <Text style={{ width: INV_COLS.uom, textAlign: 'right' }}>{it.uom}</Text>
            <Text style={{ width: INV_COLS.price, textAlign: 'right' }}>{money(it.unitPrice)}</Text>
            <Text style={{ width: INV_COLS.amt, textAlign: 'right' }}>{money(it.amount)}</Text>
            <Text style={{ width: INV_COLS.disc, textAlign: 'right' }}>{money(it.discount ?? 0)}</Text>
            <Text style={{ width: INV_COLS.net, textAlign: 'right' }}>{money(it.netAmount ?? it.amount)}</Text>
          </View>
        ))}

        <View style={{ flexGrow: 1, minHeight: 12 }} />

        {/* ── Amount in words band ────────────────────────────── */}
        {words ? (
          <View style={invS.wordsBand}><Text style={invS.wordsText}>{words}</Text></View>
        ) : null}

        {/* ── Notes box + totals ──────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View style={invS.notesBox}>
            <View style={invS.noteRow}>
              <Text style={{ width: 34 }}>Notes:</Text>
              <View style={{ flex: 1 }}>
                <Text>1. All cheques should be crossed and made payable to</Text>
                <Text style={{ marginTop: 1 }}>
                  {'    '}<Text style={{ fontWeight: 'bold' }}>{COMPANY.bankPayee}</Text>{'      '}<Text style={{ fontWeight: 'bold' }}>{COMPANY.bankAcct}</Text>
                </Text>
                <Text style={{ marginTop: 2 }}>2. Please email payment detail to <Text style={{ fontWeight: 'bold' }}>&quot;account@kl.flexxo.com.my&quot;</Text></Text>
                <Text style={{ marginTop: 1 }}>{'    '}once payment have been made.</Text>
                <Text style={{ marginTop: 2 }}>3. All goods sold are non-refundable. All goods are not returnable.</Text>
              </View>
            </View>
          </View>
          <View style={{ width: 190 }}>
            <View style={invS.totRow}><Text>SUB TOTAL</Text><Text>{money(data.subTotal)}</Text></View>
            <View style={invS.totRow}><Text>ROUNDING ADJ</Text><Text>{money(data.roundingAdj ?? 0)}</Text></View>
            <View style={invS.totRow}><Text>DISC. TOTAL</Text><Text>{money(data.totalDiscount ?? 0)}</Text></View>
            <View style={invS.netRule} />
            <View style={[invS.totRow, { marginTop: 4 }]}>
              <Text style={{ fontWeight: 'bold' }}>NET TOTAL</Text>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ fontWeight: 'bold', marginRight: 16 }}>{data.currency ?? 'MYR'}</Text>
                <Text style={{ fontWeight: 'bold' }}>{money(data.netTotal)}</Text>
              </View>
            </View>
            <View style={invS.netRule} />
          </View>
        </View>

        {/* ── Signature strip: stamp over left rule ───────────── */}
        <View style={{ flexDirection: 'row', marginTop: 10, alignItems: 'flex-end' }}>
          <View style={{ width: '28%' }}>
            {stamp ? <Image style={{ width: 72, height: 72, marginLeft: 30, marginBottom: -12 }} src={stamp} /> : <View style={{ height: 60 }} />}
            <Text style={invS.signLabel}>Authorised Signature</Text>
          </View>
          <View style={{ width: '8%' }} />
          <View style={{ width: '30%' }}><Text style={invS.signLabel}>Goods Received in Good Condition</Text></View>
          <View style={{ width: '10%' }} />
          <View style={{ width: '24%' }}><Text style={invS.signLabel}>Date Goods Received</Text></View>
        </View>

        {/* ── e-Invoice section (rendered only when data exists) ─ */}
        {data.eInvoice ? (
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
              <View style={invS.eiBand}><Text style={invS.eiTitle}>e-Invoice Information</Text></View>
              <View style={invS.eiRow}><Text style={{ width: 110 }}>e-Invoice Status</Text><Text style={{ width: 10 }}>:</Text><Text>{data.eInvoice.status ?? ''}</Text></View>
              <View style={invS.eiRow}><Text style={{ width: 110 }}>Unique Identified No.</Text><Text style={{ width: 10 }}>:</Text><Text>{data.eInvoice.uid ?? ''}</Text></View>
              <View style={invS.eiRow}><Text style={{ width: 110 }}>Validated Date &amp; Time</Text><Text style={{ width: 10 }}>:</Text><Text>{data.eInvoice.validatedAt ?? ''}</Text></View>
            </View>
            {data.eInvoice.qrDataUrl ? (
              <Image style={{ width: 56, height: 56, marginTop: 8 }} src={data.eInvoice.qrDataUrl} />
            ) : null}
          </View>
        ) : null}

        <View style={invS.bottomGreen} fixed />
      </Page>
    </Document>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SO — Sales Order (A4 LANDSCAPE warehouse picking sheet)
// ═══════════════════════════════════════════════════════════════════════════════

// Table columns (pt) — table is narrower than the page (matches the original).
const SO_COLS = { no: 19, barcode: 110, code: 96, desc: 200, picked: 35, qty: 45, uom: 40, loc: 60, bal: 55 }

const soS = StyleSheet.create({
  page:     { flexDirection: 'column', paddingTop: 18, paddingBottom: 20, paddingLeft: 31, paddingRight: 34, fontSize: 8, color: '#000', fontFamily: 'Tahoma' },
  title:    { fontSize: 15, fontWeight: 'bold' },
  boxLabel: { fontSize: 10, fontWeight: 'bold', marginBottom: 2 },
  box:      { borderWidth: 1, borderColor: '#000' },
  boxRow:   { borderBottomWidth: 0.7, borderBottomColor: '#000', paddingHorizontal: 3, paddingVertical: 2.5, fontSize: 8 },
  gridCell: { borderWidth: 0.7, borderColor: '#000', justifyContent: 'center' },
  gridHead: { fontSize: 8, fontWeight: 'bold', textAlign: 'center' },
  gridLabel:{ fontSize: 7, fontWeight: 'bold', paddingLeft: 3 },
  cbLabel:  { fontSize: 7, marginRight: 2 },
  metaRow:  { flexDirection: 'row', borderWidth: 0.7, borderColor: '#000', marginTop: -0.7 },
  metaLabel:{ width: 58, fontSize: 8, paddingHorizontal: 3, paddingVertical: 2.5, borderRightWidth: 0.7, borderRightColor: '#000' },
  metaValue:{ flex: 1, fontSize: 8, paddingHorizontal: 3, paddingVertical: 2.5 },
  th:       { flexDirection: 'row', backgroundColor: GREEN, alignItems: 'center', height: 22, marginTop: 12 },
  thText:   { color: '#fff', fontSize: 8, paddingHorizontal: 2 },
  tr:       { flexDirection: 'row', paddingVertical: 5, fontSize: 9, alignItems: 'center' },
  footRule: { borderBottomWidth: 1, borderBottomColor: '#000' },
  footLabel:{ fontSize: 9, marginTop: 22 },
})

function SoDocument({ data }: { data: QneDocPdfData }) {
  const CbItem = ({ label }: { label: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
      <Text style={soS.cbLabel}>{label}</Text>
      <Checkbox />
    </View>
  )

  const AddressBox = ({ label, name, lines, tel, attn }: { label: string; name: string; lines: string[]; tel?: string | null; attn?: string | null }) => (
    <View style={{ width: 181 }}>
      <Text style={soS.boxLabel}>{label}</Text>
      <View style={soS.box}>
        <Text style={[soS.boxRow, { fontWeight: 'bold' }]}>{name}</Text>
        {lines.map((l, i) => <Text key={i} style={soS.boxRow}>{l}</Text>)}
        <View style={{ flexDirection: 'row', borderBottomWidth: 0.7, borderBottomColor: '#000' }}>
          <Text style={{ width: '62%', fontSize: 8, paddingHorizontal: 3, paddingVertical: 2.5, borderRightWidth: 0.7, borderRightColor: '#000' }}>{tel ?? ''}</Text>
          <Text style={{ flex: 1 }} />
        </View>
        <Text style={[soS.boxRow, { fontWeight: 'bold', fontSize: 7, borderBottomWidth: 0 }]}>Attn: {attn ?? ''}</Text>
      </View>
    </View>
  )

  const SoMetaRow = ({ label, value, bold, big }: { label: string; value: string; bold?: boolean; big?: boolean }) => (
    <View style={soS.metaRow}>
      <Text style={soS.metaLabel}>{label}</Text>
      <Text style={[soS.metaValue, bold ? { fontWeight: 'bold' } : {}, big ? { fontSize: 10 } : {}]}>{value}</Text>
    </View>
  )

  return (
    <Document title={data.docNo}>
      <Page size="A4" orientation="landscape" style={soS.page}>
        <Text style={soS.title}>Sales Order</Text>

        {/* ── Header zone: Bill To · Ship To · pick grid · meta ─ */}
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          <AddressBox
            label="Bill To:" name={data.customer.name} lines={data.customer.addressLines}
            tel={data.customer.tel} attn={data.customerAttn}
          />
          <View style={{ width: 18 }} />
          <AddressBox
            label="Ship To:" name={data.shipTo?.name ?? ''} lines={data.shipTo?.addressLines ?? data.customer.addressLines}
            tel={data.shipTo?.tel} attn={data.shipTo?.attn}
          />
          <View style={{ width: 14 }} />

          {/* Pick / Check / Deliver grid + checkbox rows */}
          <View style={{ width: 200, marginTop: 12 }}>
            <View style={{ flexDirection: 'row' }}>
              <View style={[soS.gridCell, { width: 52, height: 15 }]} />
              <View style={[soS.gridCell, { width: 62, height: 15, marginLeft: -0.7 }]}><Text style={soS.gridHead}>NAME</Text></View>
              <View style={[soS.gridCell, { width: 52, height: 15, marginLeft: -0.7 }]}><Text style={soS.gridHead}>DATE</Text></View>
              <View style={[soS.gridCell, { width: 34, height: 15, marginLeft: -0.7 }]}><Text style={soS.gridHead}>TIME</Text></View>
            </View>
            {(['Pick By:', 'Check By:', 'Deliver By:'] as const).map((label, r) => (
              <View key={r} style={{ flexDirection: 'row', marginTop: -0.7 }}>
                <View style={[soS.gridCell, { width: 52, height: 23 }]}><Text style={soS.gridLabel}>{label}</Text></View>
                <View style={[soS.gridCell, { width: 62, height: 23, marginLeft: -0.7 }]} />
                <View style={[soS.gridCell, { width: 52, height: 23, marginLeft: -0.7 }]} />
                <View style={[soS.gridCell, { width: 34, height: 23, marginLeft: -0.7 }]} />
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <CbItem label="Front Picker" /><CbItem label="Paid" /><CbItem label="Installation" /><CbItem label="Furniture" />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
              <CbItem label="Back Picker" /><CbItem label="C.O.D" /><CbItem label="Delivery" /><CbItem label="Own Collect" />
            </View>
          </View>
          <View style={{ width: 12 }} />

          {/* Right meta table */}
          <View style={{ flex: 1, marginTop: 12 }}>
            <SoMetaRow label="No."           value={data.docNo} bold big />
            <SoMetaRow label="Date"          value={data.date} />
            <SoMetaRow label="Reference No." value={data.referenceNo ?? ''} />
            <SoMetaRow label="Salesman"      value={data.salesman ?? data.agent ?? ''} />
            <SoMetaRow label="Terms"         value={data.terms ?? ''} />
            <SoMetaRow label="Customer*"     value={data.customerCode ?? ''} />
            <SoMetaRow label="Page"          value={data.page ?? '1 of 1'} />
            <SoMetaRow label="Location"      value={data.locationLabel ?? ''} bold />
          </View>
        </View>

        {/* ── Item table (green header · picked checkboxes) ───── */}
        <View style={soS.th}>
          <Text style={[soS.thText, { width: SO_COLS.no }]}>No.</Text>
          <Text style={[soS.thText, { width: SO_COLS.barcode }]}>BARCODE</Text>
          <Text style={[soS.thText, { width: SO_COLS.code }]}>STOCK CODE</Text>
          <Text style={[soS.thText, { width: SO_COLS.desc }]}>DESCRIPTION</Text>
          <Text style={[soS.thText, { width: SO_COLS.picked, fontSize: 7 }]}>Picked</Text>
          <Text style={[soS.thText, { width: SO_COLS.qty, textAlign: 'right' }]}>QTY</Text>
          <Text style={[soS.thText, { width: SO_COLS.uom, textAlign: 'right' }]}>UOM</Text>
          <Text style={[soS.thText, { width: SO_COLS.loc, textAlign: 'right' }]}>LOCATION</Text>
          <Text style={[soS.thText, { width: SO_COLS.bal, fontSize: 7, textAlign: 'right' }]}>Stock{'\n'}Balance</Text>
        </View>
        {data.items.map((it, i) => {
          const short = it.stockBalance != null && it.stockBalance < it.qty
          return (
            <View key={i} style={[soS.tr, i % 2 === 1 ? { backgroundColor: ZEBRA_SO } : {}]} wrap={false}>
              <Text style={{ width: SO_COLS.no }}>{i + 1}</Text>
              <Text style={{ width: SO_COLS.barcode, paddingRight: 4 }}>{it.barcode ?? ''}</Text>
              <Text style={{ width: SO_COLS.code, paddingRight: 4 }}>{it.code}</Text>
              <Text style={{ width: SO_COLS.desc, paddingRight: 4 }}>{it.description}</Text>
              <View style={{ width: SO_COLS.picked, alignItems: 'center' }}><Checkbox size={8} /></View>
              <Text style={{ width: SO_COLS.qty, textAlign: 'right' }}>{it.qty}</Text>
              <Text style={{ width: SO_COLS.uom, textAlign: 'right' }}>{it.uom}</Text>
              <Text style={{ width: SO_COLS.loc, textAlign: 'right' }}>{it.location ?? ''}</Text>
              <Text style={{ width: SO_COLS.bal, textAlign: 'right', color: short ? '#e00000' : '#000' }}>
                {it.stockBalance != null ? it.stockBalance : ''}
              </Text>
            </View>
          )
        })}

        <View style={{ flexGrow: 1, minHeight: 10 }} />

        {/* ── Footer ──────────────────────────────────────────── */}
        <View style={soS.footRule} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={soS.footLabel}>Delivery Term:</Text>
          <View style={{ width: 130, borderBottomWidth: 1, borderBottomColor: '#000', borderStyle: 'dashed', marginLeft: 22, marginBottom: 1 }} />
        </View>
      </Page>
    </Document>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dispatch + helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Render a QNE-style document to a PDF buffer (layout picked by docType). */
export async function renderQneDocPdf(data: QneDocPdfData): Promise<Buffer> {
  switch (data.docType) {
    case 'SO':  return renderToBuffer(<SoDocument data={data} />)
    case 'DO':  return renderToBuffer(<DoDocument data={data} />)
    case 'INV': return renderToBuffer(<InvDocument data={data} />)
    default:    return renderToBuffer(<QtDocument data={data} />)
  }
}

/** File-safe title in Flexxo's convention, e.g. "QT KL2604-0075 Lavish". */
export function qneDocTitle(docNo: string, companyName: string): string {
  const shortCo = companyName
    .replace(/\b(sdn\.?\s*bhd\.?|bhd\.?|enterprise|trading|services?|corporation|corp\.?|company|co\.?|m'?sia|malaysia)\b/gi, '')
    .replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 2).join(' ')
  return `${docNo.replace(/\//g, '-')}${shortCo ? ` ${shortCo}` : ''}`.trim()
}
