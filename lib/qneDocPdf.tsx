import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

/**
 * QNE-style document PDFs (Quotation / Sales Order / Delivery Order / Tax Invoice),
 * generated in-house with @react-pdf/renderer because QNE's own Reports/PDF endpoint
 * is currently broken server-side (FileHelpers assembly error). Layout mirrors a QNE
 * printout: brand header, customer + doc meta, item table, totals. QT/INV show prices;
 * SO is a picking sheet; DO carries a received/chop box for the driver.
 */

const GREEN = '#1f9d55'

export type QneDocType = 'QT' | 'SO' | 'DO' | 'INV'

export type QneDocItem = {
  pos:       number
  code?:     string | null
  name:      string
  unit?:     string | null
  qty:       number
  unitPrice?: number | null
  amount?:   number | null
}

export type QneDocPdfData = {
  docType:     QneDocType
  code:        string        // QNE doc code, e.g. "QT KL2606/0083"
  date:        Date
  customer:    { name: string; address?: string | null; contact?: string | null; phone?: string | null }
  items:       QneDocItem[]
  subtotal?:   number | null
  tax?:        number | null
  total?:      number | null
  currency?:   string
  salesPerson?: string | null
  remark?:     string | null
}

const DOC_TITLE: Record<QneDocType, string> = {
  QT: 'QUOTATION', SO: 'SALES ORDER', DO: 'DELIVERY ORDER', INV: 'TAX INVOICE',
}
const SHOW_PRICE: Record<QneDocType, boolean> = { QT: true, SO: false, DO: false, INV: true }

const styles = StyleSheet.create({
  page:       { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontSize: 9, color: '#222', fontFamily: 'Helvetica' },
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  logo:       { width: 130, height: 40, objectFit: 'contain' },
  brandText:  { fontSize: 8, color: '#666' },
  docTitle:   { fontSize: 18, fontFamily: 'Helvetica-Bold', color: GREEN, textAlign: 'right' },
  docCode:    { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'right', marginTop: 2 },
  rule:       { borderBottomWidth: 2, borderBottomColor: GREEN, marginTop: 8, marginBottom: 12 },
  metaRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaCol:    { width: '60%' },
  metaColR:   { width: '38%' },
  metaLabel:  { fontSize: 7, color: '#888', marginBottom: 1 },
  metaValue:  { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  small:      { fontSize: 8, color: '#444', marginBottom: 2 },
  th:         { backgroundColor: GREEN, color: '#fff', flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tr:         { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e2e2', paddingVertical: 4, paddingHorizontal: 4 },
  totals:     { marginTop: 10, alignItems: 'flex-end' },
  totalRow:   { flexDirection: 'row', width: '45%', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontSize: 9, color: '#555' },
  totalValue: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  grand:      { fontSize: 11, fontFamily: 'Helvetica-Bold', color: GREEN },
  remark:     { marginTop: 14, fontSize: 8, color: '#555' },
  signBox:    { marginTop: 26, flexDirection: 'row', justifyContent: 'space-between' },
  signCell:   { width: '45%', borderTopWidth: 0.7, borderTopColor: '#999', paddingTop: 4, fontSize: 8, color: '#666' },
  footer:     { position: 'absolute', bottom: 22, left: 40, right: 40, fontSize: 7, color: '#999', textAlign: 'center' },
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

const fmtDate = (d: Date) => d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
const money = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function QneDocument({ data }: { data: QneDocPdfData }) {
  const logo = getLogo()
  const showPrice = SHOW_PRICE[data.docType]
  const isDO = data.docType === 'DO'
  const cur = data.currency ?? 'MYR'

  // Column widths differ for priced vs pick/delivery docs.
  const w = showPrice
    ? { no: '6%', code: '15%', item: '37%', unit: '8%', qty: '10%', price: '12%', amt: '12%' }
    : { no: '7%', code: '18%', item: '49%', unit: '12%', qty: '14%', price: '0%', amt: '0%' }

  return (
    <Document title={`${data.code}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {logo
              ? <Image style={styles.logo} src={logo} />
              : <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: GREEN }}>Flexxo®</Text>}
            <Text style={styles.brandText}>Flexxo (KL) Sdn Bhd — Your 1stop Office Partner</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{DOC_TITLE[data.docType]}</Text>
            <Text style={styles.docCode}>{data.code}</Text>
          </View>
        </View>
        <View style={styles.rule} />

        {/* Customer + meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{data.docType === 'INV' ? 'BILL TO' : 'CUSTOMER'}</Text>
            <Text style={styles.metaValue}>{data.customer.name}</Text>
            {data.customer.address ? <Text style={styles.small}>{data.customer.address}</Text> : null}
            {data.customer.contact || data.customer.phone
              ? <Text style={styles.small}>Attn: {[data.customer.contact, data.customer.phone].filter(Boolean).join(' · ')}</Text>
              : null}
          </View>
          <View style={styles.metaColR}>
            <Text style={styles.metaLabel}>DATE</Text>
            <Text style={styles.metaValue}>{fmtDate(data.date)}</Text>
            {data.salesPerson ? <><Text style={styles.metaLabel}>SALESPERSON</Text><Text style={styles.metaValue}>{data.salesPerson}</Text></> : null}
          </View>
        </View>

        {/* Item table */}
        <View style={styles.th}>
          <Text style={{ width: w.no }}>No</Text>
          <Text style={{ width: w.code }}>Code</Text>
          <Text style={{ width: w.item }}>Description</Text>
          <Text style={{ width: w.unit }}>UOM</Text>
          <Text style={{ width: w.qty, textAlign: 'right' }}>Qty</Text>
          {showPrice ? <Text style={{ width: w.price, textAlign: 'right' }}>Unit Price</Text> : null}
          {showPrice ? <Text style={{ width: w.amt, textAlign: 'right' }}>Amount</Text> : null}
        </View>
        {data.items.map(it => (
          <View style={styles.tr} key={it.pos} wrap={false}>
            <Text style={{ width: w.no }}>{it.pos}</Text>
            <Text style={{ width: w.code }}>{it.code ?? ''}</Text>
            <Text style={{ width: w.item }}>{it.name}</Text>
            <Text style={{ width: w.unit }}>{it.unit ?? ''}</Text>
            <Text style={{ width: w.qty, textAlign: 'right' }}>{it.qty}</Text>
            {showPrice ? <Text style={{ width: w.price, textAlign: 'right' }}>{money(it.unitPrice)}</Text> : null}
            {showPrice ? <Text style={{ width: w.amt, textAlign: 'right' }}>{money(it.amount)}</Text> : null}
          </View>
        ))}

        {/* Totals (priced docs only) */}
        {showPrice && (data.total != null || data.subtotal != null) ? (
          <View style={styles.totals}>
            {data.subtotal != null ? (
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>{cur} {money(data.subtotal)}</Text></View>
            ) : null}
            {data.tax != null ? (
              <View style={styles.totalRow}><Text style={styles.totalLabel}>SST</Text><Text style={styles.totalValue}>{cur} {money(data.tax)}</Text></View>
            ) : null}
            <View style={styles.totalRow}><Text style={[styles.totalLabel, styles.grand]}>TOTAL</Text><Text style={styles.grand}>{cur} {money(data.total)}</Text></View>
          </View>
        ) : null}

        {data.remark ? <Text style={styles.remark}>Remark: {data.remark}</Text> : null}
        {data.docType === 'QT' ? <Text style={styles.remark}>This quotation is valid for 30 days. Prices are subject to stock availability.</Text> : null}

        {/* Delivery order — received / chop box */}
        {isDO ? (
          <View style={styles.signBox}>
            <Text style={styles.signCell}>Delivered by (Flexxo / partner)</Text>
            <Text style={styles.signCell}>Received in good order — name, sign &amp; company chop</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Flexxo (KL) Sdn Bhd · Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Shah Alam, Selangor · Generated {fmtDate(new Date())}
        </Text>
      </Page>
    </Document>
  )
}

/** Render a QNE-style document to a PDF buffer. */
export async function renderQneDocPdf(data: QneDocPdfData): Promise<Buffer> {
  return renderToBuffer(<QneDocument data={data} />)
}

/**
 * Display/file title in Flexxo's naming convention from a QNE doc code + customer.
 * "QT KL2606/0083" + "Tropicana Corp Sdn Bhd" → "QT KL2606-0083 Tropicana".
 */
export function qneDocTitle(code: string, companyName: string): string {
  const shortCo = companyName
    .replace(/\b(sdn\.?\s*bhd\.?|bhd\.?|enterprise|trading|services?|corporation|corp\.?|company|co\.?|m'?sia|malaysia)\b/gi, '')
    .replace(/[^\w\s-]/g, '').trim().split(/\s+/).slice(0, 2).join(' ')
  return `${code.replace(/\//g, '-')}${shortCo ? ` ${shortCo}` : ''}`.trim()
}
