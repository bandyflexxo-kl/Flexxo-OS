import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Document, Page, View, Text, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

/**
 * QNE-style document PDFs (Quotation / Sales Order / Delivery Order / Invoice),
 * generated in-house because QNE's own Reports/PDF endpoint is broken server-side
 * (FileHelpers assembly load failure — re-confirmed 30 Jun 2026).
 *
 * This is a MEASUREMENT-DRIVEN replica of Flexxo's real QNE printout
 * (ref: "QT KL2604/0075 Lavish"). Every font, size and column position was
 * extracted from the reference PDF with PyMuPDF:
 *   - Font:  Tahoma (Bold for headings, Regular for body) — embedded below.
 *   - Sizes: company 16 · title 14 · customer 10 · meta 10 · table 8 · rows 7.5.
 *   - Columns (pt, from x=20 content-left): #16 code55 desc222 qty27 uom35
 *     price42 amt44 disc49 net43  (sum 533 = A4 595 − 20 left − 42 right).
 */

// ── Embed Tahoma (the real QNE report font) ──────────────────────────────────
Font.register({
  family: 'Tahoma',
  fonts: [
    { src: join(process.cwd(), 'public', 'fonts', 'tahoma.ttf') },
    { src: join(process.cwd(), 'public', 'fonts', 'tahomabd.ttf'), fontWeight: 'bold' },
  ],
})

// ── Static company details (from the real QNE printout) ──────────────────────────
const COMPANY = {
  name:    'FLEXXO (KL) SDN. BHD',
  address: 'No. 1, Jalan TPP 6/8, Taman Perindustrian Puchong, 47100 Puchong, Selangor.',
  tel:     'Tel :+60 11-55898115 / +60 11-55808115',
  email:   'Email: order@kl.flexxo.com.my',
  bankPayee: 'FLEXXO (KL) SDN. BHD.',
  bankAcct:  'Public Bank Bhd A/C No. 3236557300',
}

export type QneDocType = 'QT' | 'SO' | 'DO' | 'INV'

const DOC_TITLE: Record<QneDocType, string> = {
  QT: 'Quotation', SO: 'Sales Order', DO: 'Delivery Order', INV: 'Invoice',
}
// QT/INV/SO show prices; DO is a goods-out doc (no prices, qty only).
const SHOW_PRICE: Record<QneDocType, boolean> = { QT: true, SO: true, DO: false, INV: true }

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
}

export type QneDocPdfData = {
  docType:       QneDocType
  docNo:         string       // "QT KL2604/0075"
  referenceNo?:  string | null
  terms?:        string | null
  date:          string       // "22/04/2026"
  agent?:        string | null
  page?:         string       // "1 of 1"
  customer:      { name: string; addressLines: string[]; tel?: string | null }
  items:         QneDocItem[]
  amountInWords?: string
  subTotal:      number
  roundingAdj?:  number
  totalDiscount?: number
  netTotal:      number
  currency?:     string
  validity?:     string | null
  deliveryTerm?: string | null
  priceNote?:    string | null
}

// Exact column widths in points (priced docs). Sum = 533 (content width).
const COLS = { no: 16, code: 55, desc: 222, qty: 27, uom: 35, price: 42, amt: 44, disc: 49, net: 43 }
// Delivery-order columns (no prices) — redistribute the freed width into description.
const COLS_DO = { no: 16, code: 60, desc: 360, qty: 40, uom: 57 }

const styles = StyleSheet.create({
  page: { flexDirection: 'column', paddingTop: 20, paddingBottom: 22, paddingLeft: 20, paddingRight: 42, fontSize: 8, color: '#000', fontFamily: 'Tahoma' },

  // Header — logo left, company block LEFT-aligned starting at x≈173
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  logo:      { width: 118, height: 40, objectFit: 'contain' },
  tagline:   { fontSize: 7, color: '#1f9d55', marginTop: 1 },
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

let logoDataUrl: string | null | undefined
function getLogo(): string | null {
  if (logoDataUrl !== undefined) return logoDataUrl
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'flexxo-logo.png'))
    logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`
  } catch { logoDataUrl = null }
  return logoDataUrl
}

const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function QneDocument({ data }: { data: QneDocPdfData }) {
  const logo      = getLogo()
  const showPrice = SHOW_PRICE[data.docType]
  const cur       = data.currency ?? 'MYR'

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
        {showPrice ? (
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
        ) : (
          <View style={styles.tbl}>
            <View style={styles.th}>
              <Text style={{ width: COLS_DO.no }}>#</Text>
              <Text style={{ width: COLS_DO.code }}>CODE</Text>
              <Text style={{ width: COLS_DO.desc }}>DESCRIPTION</Text>
              <Text style={{ width: COLS_DO.qty, textAlign: 'right' }}>QTY</Text>
              <Text style={{ width: COLS_DO.uom, textAlign: 'center' }}>UOM</Text>
            </View>
            {data.items.map((it, i) => (
              <View key={i} style={{ paddingBottom: 7 }} wrap={false}>
                <View style={styles.tr}>
                  <Text style={{ width: COLS_DO.no }}>{i + 1}</Text>
                  <Text style={{ width: COLS_DO.code }}>{it.code}</Text>
                  <Text style={{ width: COLS_DO.desc }}>{it.description}</Text>
                  <Text style={{ width: COLS_DO.qty, textAlign: 'right' }}>{it.qty}</Text>
                  <Text style={{ width: COLS_DO.uom, textAlign: 'center' }}>{it.uom}</Text>
                </View>
                {it.subLines?.length ? (
                  <View style={{ marginLeft: COLS_DO.no + COLS_DO.code }}>
                    {it.subLines.map((s, j) => <Text key={j} style={styles.subLine}>{s}</Text>)}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

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
          {showPrice ? (
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
          ) : null}
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

/** Render a QNE-style document to a PDF buffer. */
export async function renderQneDocPdf(data: QneDocPdfData): Promise<Buffer> {
  return renderToBuffer(<QneDocument data={data} />)
}

/** File-safe title in Flexxo's convention, e.g. "QT KL2604-0075 Lavish". */
export function qneDocTitle(docNo: string, companyName: string): string {
  const shortCo = companyName
    .replace(/\b(sdn\.?\s*bhd\.?|bhd\.?|enterprise|trading|services?|corporation|corp\.?|company|co\.?|m'?sia|malaysia)\b/gi, '')
    .replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 2).join(' ')
  return `${docNo.replace(/\//g, '-')}${shortCo ? ` ${shortCo}` : ''}`.trim()
}
