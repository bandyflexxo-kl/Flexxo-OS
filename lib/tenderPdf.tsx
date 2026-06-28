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

// ── Evaluation summary ──────────────────────────────────────────────────────

export type EvalPdfData = {
  refNo: string
  tenderName: string
  threshold: number
  lockedAt: Date | null
  items: {
    pos: number; name: string; unit: string | null; qty: number
    normalUnitPrice: number | null
    awardedSupplierName: string | null
    awardedUnitPrice: number | null
    quotes: { supplierName: string; quotedUnitPrice: number; variancePct: number | null; flagged: boolean }[]
  }[]
}

const ev = StyleSheet.create({
  page:    { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, fontSize: 8, color: '#222', fontFamily: 'Helvetica' },
  title:   { fontSize: 14, fontFamily: 'Helvetica-Bold', color: GREEN },
  sub:     { fontSize: 8, color: '#666', marginBottom: 8 },
  rule:    { borderBottomWidth: 2, borderBottomColor: GREEN, marginBottom: 10 },
  th:      { flexDirection: 'row', backgroundColor: '#f0f0f0', paddingVertical: 4, paddingHorizontal: 3, fontFamily: 'Helvetica-Bold' },
  tr:      { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e6e6e6', paddingVertical: 3, paddingHorizontal: 3 },
  footer:  { position: 'absolute', bottom: 20, left: 30, right: 30, fontSize: 7, color: '#999', textAlign: 'center' },
})

function EvalDocument({ data }: { data: EvalPdfData }) {
  return (
    <Document title={`Evaluation ${data.refNo}`}>
      <Page size="A4" orientation="landscape" style={ev.page}>
        <Text style={ev.title}>Tender Evaluation Summary</Text>
        <Text style={ev.sub}>
          {data.refNo} · {data.tenderName} · variance threshold {data.threshold}%{data.lockedAt ? ` · PRICES LOCKED ${fmt(data.lockedAt)}` : ' · DRAFT'}
        </Text>
        <View style={ev.rule} />
        <View style={ev.th}>
          <Text style={{ width: '4%' }}>#</Text>
          <Text style={{ width: '26%' }}>Item</Text>
          <Text style={{ width: '7%', textAlign: 'right' }}>Qty</Text>
          <Text style={{ width: '9%', textAlign: 'right' }}>Normal</Text>
          <Text style={{ width: '32%' }}>Vendor quotes (variance)</Text>
          <Text style={{ width: '13%' }}>Awarded to</Text>
          <Text style={{ width: '9%', textAlign: 'right' }}>Tender price</Text>
        </View>
        {data.items.map(it => (
          <View style={ev.tr} key={it.pos} wrap={false}>
            <Text style={{ width: '4%' }}>{it.pos}</Text>
            <Text style={{ width: '26%' }}>{it.name}</Text>
            <Text style={{ width: '7%', textAlign: 'right' }}>{it.qty}{it.unit ? ` ${it.unit}` : ''}</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{it.normalUnitPrice != null ? it.normalUnitPrice.toFixed(2) : '—'}</Text>
            <Text style={{ width: '32%' }}>
              {it.quotes.map(q => `${q.supplierName}: ${q.quotedUnitPrice.toFixed(2)}${q.variancePct != null ? ` (${q.variancePct > 0 ? '+' : ''}${q.variancePct.toFixed(0)}%${q.flagged ? '⚠' : ''})` : ''}`).join('   ')}
            </Text>
            <Text style={{ width: '13%' }}>{it.awardedSupplierName ?? '—'}</Text>
            <Text style={{ width: '9%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{it.awardedUnitPrice != null ? it.awardedUnitPrice.toFixed(2) : '—'}</Text>
          </View>
        ))}
        <Text style={ev.footer} fixed>Flexxo (KL) Sdn Bhd · Tender evaluation · Generated {fmt(new Date())}</Text>
      </Page>
    </Document>
  )
}

export async function renderEvaluationPdf(data: EvalPdfData): Promise<Buffer> {
  return renderToBuffer(<EvalDocument data={data} />)
}

// ── Purchase Order ──────────────────────────────────────────────────────────

export type PoPdfData = {
  poNumber:          string
  tenderRef:         string
  supplierName:      string
  priceValidityDate: Date | null
  deliveryDate:      Date | null
  deliveryLocation:  string | null
  items:             { item: string; unit: string | null; qty: number; unitPrice: number }[]
}

function PoDocument({ data }: { data: PoPdfData }) {
  const logo = getLogo()
  const total = data.items.reduce((s, it) => s + it.qty * it.unitPrice, 0)
  return (
    <Document title={`PO ${data.poNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {logo ? <Image style={styles.logo} src={logo} /> : <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: GREEN }}>Flexxo®</Text>}
            <Text style={styles.brandText}>Flexxo® — Your 1stop Office Partner</Text>
          </View>
          <Text style={styles.docTitle}>PURCHASE{'\n'}ORDER</Text>
        </View>
        <View style={styles.rule} />

        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>TO (SUPPLIER)</Text>
            <Text style={styles.metaValue}>{data.supplierName}</Text>
            <Text style={styles.metaLabel}>DELIVER TO</Text>
            <Text style={styles.metaValue}>{data.deliveryLocation ?? 'Flexxo Warehouse, Shah Alam'}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>PO NUMBER</Text>
            <Text style={styles.metaValue}>{data.poNumber}</Text>
            <Text style={styles.metaLabel}>TENDER REF</Text>
            <Text style={styles.metaValue}>{data.tenderRef}</Text>
            <Text style={styles.metaLabel}>PRICE VALIDITY</Text>
            <Text style={styles.metaValue}>{fmt(data.priceValidityDate)}</Text>
            <Text style={styles.metaLabel}>REQUIRED BY</Text>
            <Text style={styles.metaValue}>{fmt(data.deliveryDate)}</Text>
          </View>
        </View>

        <View style={styles.th}>
          <Text style={styles.cNo}>No</Text>
          <Text style={styles.cItem}>Item</Text>
          <Text style={styles.cUnit}>Unit</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cPrice}>Unit Price</Text>
          <Text style={styles.cAmt}>Amount</Text>
        </View>
        {data.items.map((it, i) => (
          <View style={styles.tr} key={i} wrap={false}>
            <Text style={styles.cNo}>{i + 1}</Text>
            <Text style={styles.cItem}>{it.item}</Text>
            <Text style={styles.cUnit}>{it.unit ?? ''}</Text>
            <Text style={styles.cQty}>{it.qty}</Text>
            <Text style={styles.cPrice}>{it.unitPrice.toFixed(2)}</Text>
            <Text style={styles.cAmt}>{(it.qty * it.unitPrice).toFixed(2)}</Text>
          </View>
        ))}
        <View style={[styles.tr, { borderBottomWidth: 0 }]}>
          <Text style={styles.cNo}> </Text><Text style={styles.cItem}> </Text><Text style={styles.cUnit}> </Text>
          <Text style={styles.cQty}> </Text>
          <Text style={[styles.cPrice, { fontFamily: 'Helvetica-Bold' }]}>Total</Text>
          <Text style={[styles.cAmt, { fontFamily: 'Helvetica-Bold' }]}>RM {total.toFixed(2)}</Text>
        </View>

        <Text style={styles.note}>
          Prices are fixed per the awarded tender and valid through the price-validity date above. Please acknowledge this PO
          with your reference number and confirm the delivery date.
        </Text>
        <Text style={styles.footer} fixed>
          Flexxo (KL) Sdn Bhd · Lot 2772F, Jalan Industri 12, Kampung Baru Sungai Buloh, 47000 Shah Alam, Selangor · Generated {fmt(new Date())}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderPoPdf(data: PoPdfData): Promise<Buffer> {
  return renderToBuffer(<PoDocument data={data} />)
}
