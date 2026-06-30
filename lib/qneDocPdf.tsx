import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

/**
 * QNE-style document PDFs (Quotation / Sales Order / Delivery Order / Invoice),
 * generated in-house because QNE's own Reports/PDF endpoint is broken server-side
 * (FileHelpers assembly load failure — re-confirmed 30 Jun 2026). The layout
 * REPLICATES Flexxo's real QNE printout (ref: "QT KL2604/0075 Lavish"): company
 * header, customer + bordered meta box, bordered item table, amount-in-words,
 * notes + totals box, and the computer-generated signature footer.
 */

// ── Static company details (from the real QNE printout) ──────────────────────────
const COMPANY = {
  name:    'FLEXXO (KL) SDN. BHD.',
  address: 'No. 1, Jalan TPP 6/8, Taman Perindustrian Puchong, 47100 Puchong, Selangor.',
  tel:     'Tel :+60 11-55898115 / +60 11-55808115',
  email:   'Email: order@kl.flexxo.com.my',
  bankNote:'1. All cheques should be crossed and made payable to FLEXXO (KL) SDN. BHD.  Public Bank Bhd A/C No. 3236557300',
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

const styles = StyleSheet.create({
  page:        { paddingTop: 28, paddingBottom: 28, paddingHorizontal: 34, fontSize: 8, color: '#000', fontFamily: 'Helvetica' },

  // Header
  headerRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo:        { width: 118, height: 40, objectFit: 'contain' },
  tagline:     { fontSize: 7, color: '#1f9d55', fontFamily: 'Helvetica-Oblique', marginTop: 1 },
  coName:      { fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  coLine:      { fontSize: 7.5, textAlign: 'right', marginTop: 1 },
  hr:          { borderBottomWidth: 1, borderBottomColor: '#000', marginTop: 6 },

  title:       { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 8, marginBottom: 8 },

  // Customer + meta
  topRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  custCol:     { width: '56%' },
  custName:    { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  custLine:    { fontSize: 8, marginBottom: 1 },
  metaBox:     { width: '40%', borderWidth: 0.7, borderColor: '#000' },
  metaRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999' },
  metaRowLast: { flexDirection: 'row' },
  metaLabel:   { width: '42%', padding: 3, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#999' },
  metaValue:   { width: '58%', padding: 3, fontSize: 8, fontFamily: 'Helvetica-Bold' },

  // Item table
  tbl:         { marginTop: 12, borderTopWidth: 1, borderTopColor: '#000', borderBottomWidth: 1, borderBottomColor: '#000' },
  th:          { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', paddingVertical: 3, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tr:          { flexDirection: 'row', paddingTop: 4 },
  subLine:     { fontSize: 7.5, color: '#222', marginLeft: 4 },

  amountWords: { marginTop: 10, fontSize: 8, fontFamily: 'Helvetica-Bold' },

  // Bottom: notes + totals
  bottomRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  notesCol:    { width: '56%', fontSize: 7.5 },
  noteLine:    { marginBottom: 3, lineHeight: 1.3 },
  totalsBox:   { width: '40%' },
  totRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  totLabel:    { fontSize: 8 },
  totValue:    { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  totDivide:   { borderTopWidth: 0.7, borderTopColor: '#000', marginTop: 2, paddingTop: 2 },
  netTotal:    { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  // Footer
  thanks:      { marginTop: 16, fontSize: 7.5, lineHeight: 1.3 },
  signRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  signCell:    { width: '46%' },
  signLabel:   { fontSize: 7.5 },
  signStamp:   { fontSize: 7.5, color: '#444', textAlign: 'center', marginVertical: 8, fontFamily: 'Helvetica-Bold' },
  signRule:    { borderTopWidth: 0.7, borderTopColor: '#000', marginTop: 18, paddingTop: 2, fontSize: 7.5 },
})

// Column widths (priced vs delivery-only). Sum ≈ 100%.
function cols(showPrice: boolean) {
  return showPrice
    ? { no: '4%', code: '12%', desc: '34%', qty: '7%', uom: '7%', price: '11%', amt: '11%', disc: '7%', net: '11%' }
    : { no: '5%', code: '16%', desc: '54%', qty: '10%', uom: '15%', price: '0%', amt: '0%', disc: '0%', net: '0%' }
}

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
  const c         = cols(showPrice)
  const cur       = data.currency ?? 'MYR'

  const MetaRow = ({ label, value, last }: { label: string; value: string; last?: boolean }) => (
    <View style={last ? styles.metaRowLast : styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
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
              : <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#1f9d55' }}>FLEXXO®</Text>}
            <Text style={styles.tagline}>Your 1stop Office Partner</Text>
          </View>
          <View style={{ width: '62%' }}>
            <Text style={styles.coName}>{COMPANY.name}</Text>
            <Text style={styles.coLine}>{COMPANY.address}</Text>
            <Text style={styles.coLine}>{COMPANY.tel}</Text>
            <Text style={styles.coLine}>{COMPANY.email}</Text>
          </View>
        </View>
        <View style={styles.hr} />

        {/* ── Title ────────────────────────────────────────────── */}
        <Text style={styles.title}>{DOC_TITLE[data.docType]}</Text>

        {/* ── Customer + meta box ──────────────────────────────── */}
        <View style={styles.topRow}>
          <View style={styles.custCol}>
            <Text style={styles.custName}>{data.customer.name}</Text>
            {data.customer.addressLines.map((l, i) => <Text key={i} style={styles.custLine}>{l}</Text>)}
            {data.customer.tel ? <Text style={styles.custLine}>{data.customer.tel}</Text> : null}
          </View>
          <View style={styles.metaBox}>
            <MetaRow label="No."           value={data.docNo} />
            <MetaRow label="Reference No." value={data.referenceNo ?? ''} />
            <MetaRow label="Terms"         value={data.terms ?? ''} />
            <MetaRow label="Date"          value={data.date} />
            <MetaRow label="Agent"         value={data.agent ?? ''} />
            <MetaRow label="Page"          value={data.page ?? '1 of 1'} last />
          </View>
        </View>

        {/* ── Item table ───────────────────────────────────────── */}
        <View style={styles.tbl}>
          <View style={styles.th}>
            <Text style={{ width: c.no }}>#</Text>
            <Text style={{ width: c.code }}>CODE</Text>
            <Text style={{ width: c.desc }}>DESCRIPTION</Text>
            <Text style={{ width: c.qty, textAlign: 'right' }}>QTY</Text>
            <Text style={{ width: c.uom, textAlign: 'center' }}>UOM</Text>
            {showPrice ? <Text style={{ width: c.price, textAlign: 'right' }}>U. PRICE</Text> : null}
            {showPrice ? <Text style={{ width: c.amt, textAlign: 'right' }}>AMOUNT</Text> : null}
            {showPrice ? <Text style={{ width: c.disc, textAlign: 'right' }}>DISC.</Text> : null}
            {showPrice ? <Text style={{ width: c.net, textAlign: 'right' }}>NET AMT.</Text> : null}
          </View>

          {data.items.map((it, i) => (
            <View key={i} style={{ paddingBottom: 6 }} wrap={false}>
              <View style={styles.tr}>
                <Text style={{ width: c.no }}>{i + 1}</Text>
                <Text style={{ width: c.code }}>{it.code}</Text>
                <Text style={{ width: c.desc }}>{it.description}</Text>
                <Text style={{ width: c.qty, textAlign: 'right' }}>{it.qty}</Text>
                <Text style={{ width: c.uom, textAlign: 'center' }}>{it.uom}</Text>
                {showPrice ? <Text style={{ width: c.price, textAlign: 'right' }}>{money(it.unitPrice)}</Text> : null}
                {showPrice ? <Text style={{ width: c.amt, textAlign: 'right' }}>{money(it.amount)}</Text> : null}
                {showPrice ? <Text style={{ width: c.disc, textAlign: 'right' }}>{it.discount ? money(it.discount) : ''}</Text> : null}
                {showPrice ? <Text style={{ width: c.net, textAlign: 'right' }}>{money(it.netAmount ?? it.amount)}</Text> : null}
              </View>
              {it.subLines?.length ? (
                <View style={{ marginLeft: `${parseFloat(c.no) + parseFloat(c.code)}%`, marginTop: 2 }}>
                  {it.subLines.map((s, j) => <Text key={j} style={styles.subLine}>{s}</Text>)}
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* ── Amount in words ──────────────────────────────────── */}
        {data.amountInWords ? <Text style={styles.amountWords}>{data.amountInWords}</Text> : null}

        {/* ── Notes + Totals ───────────────────────────────────── */}
        <View style={styles.bottomRow}>
          <View style={styles.notesCol}>
            <Text style={styles.noteLine}>Note: {COMPANY.bankNote}</Text>
            {data.validity ? <Text style={styles.noteLine}>Validity        : {data.validity}</Text> : null}
            <Text style={styles.noteLine}>Delivery Term : {data.deliveryTerm ?? 'Orders with ready stock will be shipped within 48 hours.'}</Text>
            <Text style={styles.noteLine}>Note            : {data.priceNote ?? 'Prices are subject to change without prior notice.'}</Text>
          </View>
          {showPrice ? (
            <View style={styles.totalsBox}>
              <View style={styles.totRow}><Text style={styles.totLabel}>SUB TOTAL</Text><Text style={styles.totValue}>{money(data.subTotal)}</Text></View>
              <View style={styles.totRow}><Text style={styles.totLabel}>ROUNDING ADJ</Text><Text style={styles.totValue}>{money(data.roundingAdj ?? 0)}</Text></View>
              <View style={styles.totRow}><Text style={styles.totLabel}>TOTAL DISCOUNT</Text><Text style={styles.totValue}>{money(data.totalDiscount ?? 0)}</Text></View>
              <View style={[styles.totRow, styles.totDivide]}>
                <Text style={styles.netTotal}>NET TOTAL</Text>
                <Text style={styles.netTotal}>{money(data.netTotal)}</Text>
              </View>
              <Text style={{ fontSize: 8, textAlign: 'right', marginTop: 2 }}>{cur}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Footer ───────────────────────────────────────────── */}
        <Text style={styles.thanks}>
          We hope that our {DOC_TITLE[data.docType].toLowerCase()} is favourable to you and looking forward to receive your valued orders in due course. Thank and regards.
        </Text>
        <View style={styles.signRow}>
          <View style={styles.signCell}>
            <Text style={styles.signLabel}>Yours faithfully,</Text>
            <Text style={styles.signStamp}>COMPUTER GENERATED{'\n'}NO SIGNATURE REQUIRED</Text>
            <Text style={styles.signRule}>Authorised Signature</Text>
          </View>
          <View style={styles.signCell}>
            <Text style={styles.signLabel}>Confirmation Order</Text>
            <Text style={[styles.signLabel, { marginTop: 4 }]}>Acknowledged by,</Text>
            <Text style={[styles.signRule, { marginTop: 22 }]}>Name:</Text>
            <Text style={[styles.signLabel, { marginTop: 6 }]}>Designation:</Text>
            <Text style={[styles.signLabel, { marginTop: 6 }]}>Date:</Text>
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
