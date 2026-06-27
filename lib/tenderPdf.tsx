import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

// Flexxo brand green
const GREEN = '#1f9d55'

const styles = StyleSheet.create({
  page:       { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, color: '#222', fontFamily: 'Helvetica' },
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  logo:       { width: 130, height: 40, objectFit: 'contain' },
  brandText:  { fontSize: 8, color: '#666' },
  docTitle:   { fontSize: 16, fontFamily: 'Helvetica-Bold', color: GREEN, textAlign: 'right' },
  rule:       { borderBottomWidth: 2, borderBottomColor: GREEN, marginTop: 8, marginBottom: 12 },
  metaRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaCol:    { width: '48%' },
  metaLabel:  { fontSize: 7, color: '#888', marginBottom: 1 },
  metaValue:  { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#444', marginBottom: 4, textTransform: 'uppercase' },
  th:         { backgroundColor: GREEN, color: '#fff', flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tr:         { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e2e2', paddingVertical: 4, paddingHorizontal: 4 },
  cNo:        { width: '7%' },
  cItem:      { width: '45%' },
  cUnit:      { width: '12%' },
  cQty:       { width: '12%', textAlign: 'right' },
  cPrice:     { width: '12%', textAlign: 'right' },
  cAmt:       { width: '12%', textAlign: 'right' },
  note:       { marginTop: 16, fontSize: 8, color: '#555', lineHeight: 1.4 },
  footer:     { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 7, color: '#999', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#ddd', paddingTop: 6 },
})

export type RfqPdfData = {
  refNo:            string
  tenderName:       string
  submissionExpiry: Date | null
  periodEnd:        Date | null
  supplierName:     string
  quoteValidityDays: number | null
  items:            { pos: number; name: string; unit: string | null; qty: number }[]
}

let logoDataUrl: string | null | undefined
function getLogo(): string | null {
  if (logoDataUrl !== undefined) return logoDataUrl
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'flexxo-logo.png'))
    logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    logoDataUrl = null
  }
  return logoDataUrl
}

const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

function RfqDocument({ data }: { data: RfqPdfData }) {
  const logo = getLogo()
  return (
    <Document title={`RFQ ${data.refNo}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {logo
              ? <Image style={styles.logo} src={logo} />
              : <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: GREEN }}>Flexxo®</Text>}
            <Text style={styles.brandText}>Flexxo® — Your 1stop Office Partner</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>REQUEST FOR{'\n'}QUOTATION</Text>
          </View>
        </View>
        <View style={styles.rule} />

        {/* Meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>TO (SUPPLIER)</Text>
            <Text style={styles.metaValue}>{data.supplierName}</Text>
            <Text style={styles.metaLabel}>TENDER</Text>
            <Text style={styles.metaValue}>{data.tenderName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>RFQ REFERENCE</Text>
            <Text style={styles.metaValue}>{data.refNo}</Text>
            <Text style={styles.metaLabel}>QUOTE SUBMISSION BY</Text>
            <Text style={styles.metaValue}>{fmt(data.submissionExpiry)}</Text>
            <Text style={styles.metaLabel}>QUOTE VALIDITY REQUIRED</Text>
            <Text style={styles.metaValue}>{data.quoteValidityDays ? `${data.quoteValidityDays} days` : '— (state in your reply)'}</Text>
          </View>
        </View>

        {/* Items */}
        <Text style={styles.sectionTitle}>Items requested</Text>
        <View style={styles.th}>
          <Text style={styles.cNo}>No</Text>
          <Text style={styles.cItem}>Item</Text>
          <Text style={styles.cUnit}>Unit</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cPrice}>Unit Price</Text>
          <Text style={styles.cAmt}>Amount</Text>
        </View>
        {data.items.map(it => (
          <View style={styles.tr} key={it.pos} wrap={false}>
            <Text style={styles.cNo}>{it.pos}</Text>
            <Text style={styles.cItem}>{it.name}</Text>
            <Text style={styles.cUnit}>{it.unit ?? ''}</Text>
            <Text style={styles.cQty}>{it.qty}</Text>
            <Text style={styles.cPrice}> </Text>
            <Text style={styles.cAmt}> </Text>
          </View>
        ))}

        <Text style={styles.note}>
          Please quote your best unit price (MYR) for each item above and return this RFQ with prices filled in, together with
          your quote validity period. An editable item schedule (Excel) accompanies this document. Prices should be inclusive of
          delivery to our Shah Alam warehouse unless stated otherwise.
        </Text>

        <Text style={styles.footer} fixed>
          Flexxo (KL) Sdn Bhd · Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Shah Alam, Selangor ·
          Generated {fmt(new Date())}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderRfqPdf(data: RfqPdfData): Promise<Buffer> {
  return renderToBuffer(<RfqDocument data={data} />)
}
