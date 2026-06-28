/**
 * COMPREHENSIVE QA/QC — full tender lifecycle + guards + RBAC + integrity.
 * Run: VERIFY_BASE=http://localhost:3100 npx tsx scripts/_verifyTenderFull.ts
 */
import { config } from 'dotenv'; import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { SignJWT } from 'jose'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const results: string[] = []
let pass = 0, fail = 0
const ok = (label: string, cond: boolean, extra = '') => { results.push(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++ }

async function main() {
  const { prisma } = await import('../lib/prisma')
  const admin = await prisma.user.findFirst({ where: { email: 'admin@flexxo.com.my' }, select: { id: true, name: true, email: true } })
  if (!admin) throw new Error('no admin')
  // Ensure 2 test suppliers exist (local DB may hold only "QNE Internal")
  const supA = await prisma.supplier.create({ data: { name: 'QA Supplier A', nameNormalized: 'qa supplier a' }, select: { id: true, name: true } })
  const supB = await prisma.supplier.create({ data: { name: 'QA Supplier B', nameNormalized: 'qa supplier b' }, select: { id: true, name: true } })
  const cleanupSuppliers = async () => { await prisma.supplier.deleteMany({ where: { id: { in: [supA.id, supB.id] } } }) }

  const key = new TextEncoder().encode(process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET)
  const mint = (role: string) => new SignJWT({ userId: admin.id, name: admin.name, email: admin.email, role, mustChangePassword: false, expiresAt: new Date(Date.now() + 86400000).toISOString() })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('24h').sign(key)
  const tok: Record<string, string> = {}
  for (const r of ['Admin', 'Manager', 'Purchaser', 'Warehouse', 'Salesperson', 'SuperAdmin']) tok[r] = await mint(r)

  const call = (path: string, role: string, init: RequestInit = {}) =>
    fetch(BASE + path, { ...init, redirect: 'manual', headers: { 'Content-Type': 'application/json', Cookie: `crm_session=${tok[role]}`, ...(init.headers ?? {}) } })
  const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) })
  // Server-render smoke: the detail PAGE (not API) must render without 500 at each stage
  const pageOk = async (label: string, idForPage: string) => {
    const r = await call(`/tenders/${idForPage}`, 'Admin')
    ok(`page renders: ${label}`, r.status === 200, `status ${r.status}`)
  }

  // ── RBAC: who can create ──────────────────────────────────────────────────
  ok('RBAC: Warehouse cannot create', (await call('/api/tenders', 'Warehouse', { method: 'POST', body: '{}' })).status === 403)
  ok('RBAC: Purchaser cannot create', (await call('/api/tenders', 'Purchaser', { method: 'POST', body: '{}' })).status === 403)

  // ── Create (Admin) ────────────────────────────────────────────────────────
  const cr = await j(await call('/api/tenders', 'Admin', { method: 'POST', body: JSON.stringify({
    name: 'TEST FULL lifecycle', mode: 'multi',
    items: [{ name: 'A4 Paper 80gsm', unit: 'REAM', qty: 100, targetPrice: 14 }, { name: 'Ballpoint pen', unit: 'BOX', qty: 50, targetPrice: 25 }],
    vendorSupplierIds: [supA.id, supB.id],
  }) }))
  ok('create tender', cr.status === 201, cr.body.refNo)
  const id = cr.body.id as string
  if (!id) { console.log(results.join('\n')); throw new Error('abort: create failed') }
  const itemsDb = await prisma.tenderItem.findMany({ where: { tenderId: id }, orderBy: { pos: 'asc' }, select: { id: true } })
  const [it1, it2] = itemsDb

  // ── Gate 1 ────────────────────────────────────────────────────────────────
  ok('Gate1: Admin blocked (not gatekeeper)', (await call(`/api/tenders/${id}/gate1`, 'Admin', { method: 'POST' })).status === 403)
  ok('Gate1: Manager ok', (await j(await call(`/api/tenders/${id}/gate1`, 'Manager', { method: 'POST' }))).body.stage === 'rfq')

  // ── RFQ: vendor reply + RFQ PDF ───────────────────────────────────────────
  const vA = await prisma.tenderVendor.findFirst({ where: { tenderId: id, supplierId: supA.id }, select: { id: true } })
  ok('vendor PATCH price_received', (await call(`/api/tenders/${id}/vendors`, 'Salesperson', { method: 'PATCH', body: JSON.stringify({ vendorId: vA!.id, replyStatus: 'price_received', quoteValidityDays: 30 }) })).status === 200)
  const rfqPdf = await call(`/api/tenders/${id}/rfq-pdf?supplierId=${supA.id}`, 'Admin')
  ok('RFQ PDF', rfqPdf.status === 200 && (rfqPdf.headers.get('content-type') ?? '').includes('pdf'))

  // ── Gate 2 ────────────────────────────────────────────────────────────────
  ok('Gate2: Salesperson blocked', (await call(`/api/tenders/${id}/gate2`, 'Salesperson', { method: 'POST', body: '{}' })).status === 403)
  await pageOk('rfq stage', id)
  ok('Gate2: Manager → evaluation', (await j(await call(`/api/tenders/${id}/gate2`, 'Manager', { method: 'POST', body: '{}' }))).body.stage === 'evaluation')
  await pageOk('evaluation stage', id)

  // ── Evaluation: quotes + variance flag ────────────────────────────────────
  // normals: it1=10, it2=20. supA it1=11 (+10% → flagged @5%), it2=21. supB it1=9.5, it2=22
  const qres = await j(await call(`/api/tenders/${id}/quotes`, 'Manager', { method: 'POST', body: JSON.stringify({
    normals: [{ tenderItemId: it1.id, normalUnitPrice: 10 }, { tenderItemId: it2.id, normalUnitPrice: 20 }],
    quotes: [
      { tenderItemId: it1.id, supplierId: supA.id, quotedUnitPrice: 11 },
      { tenderItemId: it2.id, supplierId: supA.id, quotedUnitPrice: 21 },
      { tenderItemId: it1.id, supplierId: supB.id, quotedUnitPrice: 9.5 },
      { tenderItemId: it2.id, supplierId: supB.id, quotedUnitPrice: 20.5 },
    ],
  }) }))
  ok('quotes saved (4)', qres.body.saved === 4, `saved ${qres.body.saved}`)
  const flaggedQ = await prisma.tenderVendorQuote.findFirst({ where: { tenderItemId: it1.id, supplierId: supA.id }, select: { flaggedOverThreshold: true, variancePct: true } })
  ok('variance flag set (supA it1 +10%)', flaggedQ?.flaggedOverThreshold === true, `variance ${flaggedQ?.variancePct}`)

  // Award flagged item without reason → 422
  const awBad = await call(`/api/tenders/${id}/award`, 'Manager', { method: 'POST', body: JSON.stringify({ awards: [
    { tenderItemId: it1.id, supplierId: supA.id, awardedUnitPrice: 10.5 },
    { tenderItemId: it2.id, supplierId: supB.id, awardedUnitPrice: 21 },
  ] }) })
  ok('award flagged w/o reason → 422', awBad.status === 422)

  // Award with reason → lock
  const awGood = await j(await call(`/api/tenders/${id}/award`, 'Manager', { method: 'POST', body: JSON.stringify({ awards: [
    { tenderItemId: it1.id, supplierId: supA.id, awardedUnitPrice: 10.5, overrideReason: 'Sole supplier with stock; negotiated down from 11.' },
    { tenderItemId: it2.id, supplierId: supB.id, awardedUnitPrice: 21 },
  ] }) }))
  ok('award + lock → client_po', awGood.body.stage === 'client_po', `status ${awGood.status} ${JSON.stringify(awGood.body).slice(0, 160)}`)

  // Price-lock immutability: quotes now blocked
  ok('price-lock: quotes blocked after lock', (await call(`/api/tenders/${id}/quotes`, 'Manager', { method: 'POST', body: JSON.stringify({ quotes: [] }) })).status === 409)

  // ── Client PO + Gate 3 ────────────────────────────────────────────────────
  ok('clientPO: Salesperson blocked', (await call(`/api/tenders/${id}/client-po`, 'Salesperson', { method: 'POST', body: '{}' })).status === 403)
  const cpo = await call(`/api/tenders/${id}/client-po`, 'Purchaser', { method: 'POST', body: JSON.stringify({ poNumber: 'CLIENT-PO-1', items: [{ tenderItemId: it1.id, qtyCovered: 100 }, { tenderItemId: it2.id, qtyCovered: 50 }] }) })
  ok('clientPO logged', cpo.status === 201)
  await pageOk('client_po stage', id)
  ok('Gate3 → supplier_po', (await j(await call(`/api/tenders/${id}/gate3`, 'Purchaser', { method: 'POST' }))).body.stage === 'supplier_po')

  // ── Supplier PO: over-order guard + valid ─────────────────────────────────
  const over = await call(`/api/tenders/${id}/supplier-po`, 'Purchaser', { method: 'POST', body: JSON.stringify({ supplierId: supA.id, items: [{ tenderItemId: it1.id, qty: 999 }] }) })
  ok('supplierPO over-order blocked (409)', over.status === 409)
  const poA = await j(await call(`/api/tenders/${id}/supplier-po`, 'Purchaser', { method: 'POST', body: JSON.stringify({ supplierId: supA.id, items: [{ tenderItemId: it1.id, qty: 100 }] }) }))
  ok('supplierPO issued (supA)', poA.status === 201, poA.body.poNumber)
  // wrong-supplier guard: it1 awarded to supA, try ordering from supB
  ok('supplierPO wrong-supplier blocked', (await call(`/api/tenders/${id}/supplier-po`, 'Purchaser', { method: 'POST', body: JSON.stringify({ supplierId: supB.id, items: [{ tenderItemId: it1.id, qty: 1 }] }) })).status === 400)
  const poB = await j(await call(`/api/tenders/${id}/supplier-po`, 'Purchaser', { method: 'POST', body: JSON.stringify({ supplierId: supB.id, items: [{ tenderItemId: it2.id, qty: 50 }] }) }))
  ok('supplierPO issued (supB)', poB.status === 201)

  // Immutable price check: PO line unitPrice == awardedUnitPrice (10.5)
  const poALine = await prisma.supplierPOItem.findFirst({ where: { supplierPoId: poA.body.id }, select: { unitPrice: true, id: true } })
  ok('PO line price = frozen awarded (10.5)', Number(poALine?.unitPrice) === 10.5, String(poALine?.unitPrice))

  // PO PDF (retry once for cold-compile of this deep route)
  let poPdf = await call(`/api/tenders/${id}/supplier-po/${poA.body.id}/pdf`, 'Purchaser')
  if (poPdf.status !== 200) { await new Promise(r => setTimeout(r, 2500)); poPdf = await call(`/api/tenders/${id}/supplier-po/${poA.body.id}/pdf`, 'Purchaser') }
  ok('PO PDF', poPdf.status === 200 && (poPdf.headers.get('content-type') ?? '').includes('pdf'), `status ${poPdf.status}`)

  // ── GRN: over-delivery guard + 3-way match ────────────────────────────────
  ok('GRN over-delivery blocked', (await call(`/api/tenders/${id}/grn`, 'Warehouse', { method: 'POST', body: JSON.stringify({ supplierPoId: poA.body.id, lines: [{ supplierPoItemId: poALine!.id, qtyReceived: 200 }] }) })).status === 409)
  const grn1 = await j(await call(`/api/tenders/${id}/grn`, 'Warehouse', { method: 'POST', body: JSON.stringify({ supplierPoId: poA.body.id, lines: [{ supplierPoItemId: poALine!.id, qtyReceived: 60 }] }) }))
  ok('GRN partial → partially_received', grn1.body.poStatus === 'partially_received', grn1.body.grnNumber)
  const grn2 = await j(await call(`/api/tenders/${id}/grn`, 'Warehouse', { method: 'POST', body: JSON.stringify({ supplierPoId: poA.body.id, lines: [{ supplierPoItemId: poALine!.id, qtyReceived: 40 }] }) }))
  ok('GRN full → received', grn2.body.poStatus === 'received')

  // Balance correctness (direct query — lib/tenderBalance is server-only)
  const poItemsB = await prisma.supplierPOItem.findMany({ where: { tenderItemId: it1.id }, select: { qty: true, grnItems: { select: { qtyReceived: true } } } })
  const ordered1 = poItemsB.reduce((s, p) => s + Number(p.qty), 0)
  const delivered1 = poItemsB.reduce((s, p) => s + p.grnItems.reduce((a, g) => a + Number(g.qtyReceived), 0), 0)
  ok('balance: it1 ordered=100 delivered=100 remaining=0', ordered1 === 100 && delivered1 === 100 && (100 - ordered1) === 0, `ordered ${ordered1}, delivered ${delivered1}`)

  await pageOk('receiving stage', id)
  { const lr = await call('/tenders', 'Admin'); ok('page renders: tenders list', lr.status === 200) }

  // ── QNE write gating (flag OFF) — no QNE codes written ─────────────────────
  const tQne = await prisma.tender.findUnique({ where: { id }, select: { qneProjectCode: true } })
  const poQne = await prisma.supplierPO.findFirst({ where: { tenderId: id }, select: { qnePoCode: true } })
  const grnQne = await prisma.goodsReceipt.findFirst({ where: { supplierPo: { tenderId: id } }, select: { qneGrnCode: true } })
  ok('QNE gating: no project/PO/GRN codes written (flag off)', tQne?.qneProjectCode == null && poQne?.qnePoCode == null && grnQne?.qneGrnCode == null)

  // ── Close ─────────────────────────────────────────────────────────────────
  ok('close → closed/won', (await j(await call(`/api/tenders/${id}/close`, 'Manager', { method: 'POST', body: JSON.stringify({ status: 'won' }) }))).body.stage === 'closed')

  // Evaluation PDF
  ok('Evaluation PDF', (await call(`/api/tenders/${id}/evaluation-pdf`, 'Admin')).status === 200)

  // ── Audit trail ───────────────────────────────────────────────────────────
  const audit = await prisma.auditLog.count({ where: { tableName: { in: ['tenders', 'tender_items', 'tender_vendor_quotes', 'supplier_pos', 'goods_receipts'] }, recordId: { in: [id, it1.id] } } })
  ok('audit trail recorded', audit > 0, `${audit} rows (sampled)`)
  const amendments = await prisma.tenderAmendment.count({ where: { tenderId: id } })
  ok('amendments logged (gates+lock+close)', amendments >= 4, `${amendments}`)

  // ── Cascade integrity ─────────────────────────────────────────────────────
  await prisma.tender.delete({ where: { id } })
  const leftover = await prisma.tenderItem.count({ where: { tenderId: id } })
    + await prisma.tenderVendor.count({ where: { tenderId: id } })
    + await prisma.supplierPO.count({ where: { tenderId: id } })
    + await prisma.clientPO.count({ where: { tenderId: id } })
    + await prisma.tenderAmendment.count({ where: { tenderId: id } })
  const grnLeft = await prisma.goodsReceipt.count({ where: { supplierPo: { tenderId: id } } })
  ok('cascade delete: children removed', leftover === 0 && grnLeft === 0, `items/vendors/po/cpo/amend=${leftover}, grn=${grnLeft}`)
  // cleanup approvals (not cascaded — entityId is a plain string)
  await prisma.approvalRequest.deleteMany({ where: { entityType: 'tender', entityId: id } })
  await cleanupSuppliers()
  results.push('🧹 cleaned up')

  console.log('\n' + results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exitCode = 1
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(e => {
  console.log('\n' + results.join('\n'))
  console.error('\nTHREW:', e instanceof Error ? e.message : e)
  process.exit(1)
})
