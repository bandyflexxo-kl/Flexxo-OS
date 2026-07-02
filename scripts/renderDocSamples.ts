/**
 * renderDocSamples.ts — golden-sample renders for the 4 QNE document layouts.
 *
 * Renders one PDF per doc type into docs/pdf-golden/ using payloads transcribed
 * from the REAL printouts archived in docs/pdf-originals/. Run after ANY edit to
 * lib/qneDocPdf.tsx and eyeball the output against the originals — this is the
 * layout-drift guard ("same QT, same design, every time").
 *
 * Run: npx tsx scripts/renderDocSamples.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const { renderQneDocPdf, myrAmountInWords } = await import('@/lib/qneDocPdf')
  type Data = Parameters<typeof renderQneDocPdf>[0]

  const outDir = resolve(process.cwd(), 'docs', 'pdf-golden')
  mkdirSync(outDir, { recursive: true })

  const TROPICANA = {
    name: 'TROPICANA CORPORATION BERHAD',
    addressLines: [
      'UNIT 1301, LEVEL 13,',
      'TROPICANA GARDENS OFFICE TOWER,',
      'NO.2A, PERSIARAN SURIAN, TROPICANA INDAH,',
      '47810 PETALING JAYA, SELANGOR.',
    ],
  }

  // ── SO golden — ref "SO KL2606/0136 TROPICANA" ─────────────────────────────
  const so: Data = {
    docType: 'SO',
    docNo: 'SO KL2606/0136',
    date: '26/06/2026   04:16 PM',
    referenceNo: 'AD/0176/2026',
    salesman: 'BANDY',
    terms: 'C.O.D.',
    customerCode: '700-T008',
    page: '1 of 1',
    locationLabel: 'STORE',
    customer: { ...TROPICANA, tel: 'TEL: 014-366 0268' },
    customerAttn: 'LEE HUI YIN',
    shipTo: { addressLines: TROPICANA.addressLines, tel: 'TEL: 018-238 5797', attn: 'NIK NURNISRINA' },
    items: [
      { code: 'SPRITZER 250ML',        description: 'SPRITZER MINERAL WATER 24 X 250ML',    qty: 45, uom: 'BOX', location: 'STORE', stockBalance: 1 },
      { code: 'KLEENEX TISSUE3PLY50S', description: 'KLEENEX FACIAL TISSUE 3PLYX4X50S',     qty: 25, uom: 'PKT', location: 'STORE' },
      { code: 'KLEENEX TISSUE3PLY90S', description: 'KLEENEX FACIAL TISSUE BOX 3PLYX5X90S', qty: 10, uom: 'PKT', location: 'STORE' },
    ],
  }

  // ── DO golden — ref "DO KL2607/0001 TROPICANA" ─────────────────────────────
  const doData: Data = {
    docType: 'DO',
    docNo: 'DO KL2607/0001',
    date: '01/07/2026',
    referenceNo: 'AD/0176/2026',
    customerCode: '700-T008',
    salesman: 'SALES 6',
    orderNo: 'SO KL2606/0136',
    page: '1 of 1',
    customer: { ...TROPICANA, tel: '014-366 0268' },
    customerAttn: 'LEE HUI YIN',
    shipTo: { addressLines: TROPICANA.addressLines, tel: '018-238 5797', attn: 'NIK NURNISRINA' },
    items: [
      { code: 'SPRITZER 250ML',        description: 'SPRITZER MINERAL WATER 24 X 250ML',    qty: 45, uom: 'BOX' },
      { code: 'KLEENEX TISSUE3PLY50S', description: 'KLEENEX FACIAL TISSUE 3PLYX4X50S',     qty: 14, uom: 'PKT' },
      { code: 'KLEENEX TISSUE3PLY90S', description: 'KLEENEX FACIAL TISSUE BOX 3PLYX5X90S', qty: 10, uom: 'PKT' },
    ],
    totalQty: 69,
  }

  // ── INV golden — ref "INV KL2606/00137 AF IOI KULAI" ───────────────────────
  const AFIOI = [
    'L1-05/06/07 & L1-0S06,',
    'FIRST FLOOR, IOI MALL KULAI,',
    'LEBUH PUTRA UTAMA, BANDAR PUTRA KULAI,',
    '81000 KULAI, JOHOR.',
  ]
  const inv: Data = {
    docType: 'INV',
    docNo: 'INV KL2606/00137',
    date: '30/06/2026',
    yourPoNo: 'PO-0025/AFIK',
    orderNo: 'DO KL2606/0011',
    salesman: 'SALES 6',
    terms: 'C.O.D.',
    customerCode: '700-A025',
    page: '1 of 1',
    customer: { name: 'AF IOI KULAI SDN. BHD.', addressLines: AFIOI, tel: '60136604267' },
    customerTin: 'C60088867030',
    customerTel2: 'NA',
    customerAttn: 'ZAQWAN',
    shipTo: { addressLines: AFIOI, tel: '60136604267', tel2: 'NA', attn: 'ZAQWAN' },
    items: [
      { code: '2PLYJUMBOROLL', description: 'DFINE 2PLY JUMBO ROLL 600G (12ROLL/CTN)',  qty: 96, uom: 'ROLL',         unitPrice: 6.50,   amount: 624.00, discount: 0, netAmount: 624.00 },
      { code: 'INTERFOLDTOW',  description: "INTERFOLD FOLD TOWEL 200'S (20 PACK/CTN)", qty: 40, uom: 'PKT',          unitPrice: 5.40,   amount: 216.00, discount: 0, netAmount: 216.00 },
      { code: 'DELIVERYFEE',   description: 'DELIVERY FEE',                             qty: 1,  uom: 'ONE WAY TRIP', unitPrice: 250.00, amount: 250.00, discount: 0, netAmount: 250.00 },
    ],
    subTotal: 1090.00,
    roundingAdj: 0,
    totalDiscount: 0,
    netTotal: 1090.00,
    eInvoice: { status: 'Valid', uid: 'MBRCSQARDG7HFTW9JKAHJDWK10', validatedAt: '01/07/2026 8:51:19 AM' },
  }

  // ── QT golden — same data as INV, in the approved quotation layout ─────────
  const qt: Data = {
    docType: 'QT',
    docNo: 'QT KL2604/0075',
    referenceNo: '',
    terms: 'C.O.D.',
    date: '22/04/2026',
    agent: 'SALES 6',
    page: '1 of 1',
    customer: { name: 'AF IOI KULAI SDN. BHD.', addressLines: AFIOI, tel: '60136604267' },
    items: inv.items,
    subTotal: 1090.00,
    netTotal: 1090.00,
    validity: '30 days',
  }

  console.log('amount-in-words check:', myrAmountInWords(1090))
  for (const [name, data] of [['SO', so], ['DO', doData], ['INV', inv], ['QT', qt]] as const) {
    const buf = await renderQneDocPdf(data)
    const out = resolve(outDir, `golden-${name}.pdf`)
    writeFileSync(out, buf)
    console.log(`${name}: ${buf.length} bytes → ${out}`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
