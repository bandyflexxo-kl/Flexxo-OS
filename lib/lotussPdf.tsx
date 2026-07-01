import 'server-only'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

/**
 * Lotus's price-match PDF — item name (the salesperson's search term), product
 * image, and the ×1.2 price. Deliberately contains NO Lotus's link.
 */
export type LotussPdfData = {
  title: string
  rows:  { name: string; imageData: string | null; price: number }[]   // price already marked up
}

const styles = StyleSheet.create({
  page:    { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
  title:   { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4, color: '#111827' },
  sub:     { fontSize: 9, color: '#6b7280', marginBottom: 14 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111827', paddingBottom: 4, marginBottom: 2 },
  hIdx:    { width: '8%', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  hImg:    { width: '18%', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  hName:   { width: '54%', fontFamily: 'Helvetica-Bold', fontSize: 9 },
  hPrice:  { width: '20%', fontFamily: 'Helvetica-Bold', fontSize: 9, textAlign: 'right' },
  row:     { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 6 },
  idx:     { width: '8%', color: '#9ca3af' },
  imgCell: { width: '18%' },
  img:     { width: 42, height: 42, objectFit: 'contain' },
  imgPh:   { width: 42, height: 42, backgroundColor: '#f3f4f6', borderRadius: 3 },
  name:    { width: '54%', paddingRight: 8 },
  price:   { width: '20%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  total:   { flexDirection: 'row', marginTop: 10, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#111827' },
  tLabel:  { width: '80%', textAlign: 'right', fontFamily: 'Helvetica-Bold', paddingRight: 8 },
  tVal:    { width: '20%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  foot:    { marginTop: 18, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
})

const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function LotussDocument({ data }: { data: LotussPdfData }) {
  const total = data.rows.reduce((s, r) => s + r.price, 0)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.sub}>Quotation — {data.rows.length} item(s) · generated {new Date().toLocaleDateString('en-GB')}</Text>

        <View style={styles.headRow}>
          <Text style={styles.hIdx}>#</Text>
          <Text style={styles.hImg}>Photo</Text>
          <Text style={styles.hName}>Item</Text>
          <Text style={styles.hPrice}>Price</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.idx}>{i + 1}</Text>
            <View style={styles.imgCell}>
              {r.imageData ? <Image src={r.imageData} style={styles.img} /> : <View style={styles.imgPh} />}
            </View>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.price}>{rm(r.price)}</Text>
          </View>
        ))}

        <View style={styles.total}>
          <Text style={styles.tLabel}>Total</Text>
          <Text style={styles.tVal}>{rm(total)}</Text>
        </View>

        <Text style={styles.foot}>Flexxo (KL) Sdn Bhd — computer-generated quotation.</Text>
      </Page>
    </Document>
  )
}

export async function renderLotussPdf(data: LotussPdfData): Promise<Buffer> {
  return renderToBuffer(<LotussDocument data={data} />)
}
