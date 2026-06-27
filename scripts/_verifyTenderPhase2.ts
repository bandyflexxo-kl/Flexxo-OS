/**
 * E2E smoke test for Phase-2 (RFQ → vendor tracking → RFQ PDF → Gate 2).
 * Run against the verify server: VERIFY_BASE=http://localhost:3100 npx tsx scripts/_verifyTenderPhase2.ts
 */
import { config } from 'dotenv'; import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { SignJWT } from 'jose'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'

async function mint(u: { userId: string; name: string; email: string }, role: string) {
  const key = new TextEncoder().encode(process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET)
  return new SignJWT({ userId: u.userId, name: u.name, email: u.email, role, mustChangePassword: false, expiresAt: new Date(Date.now() + 86400000).toISOString() })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('24h').sign(key)
}
const call = (path: string, tok: string, init: RequestInit = {}) =>
  fetch(BASE + path, { ...init, redirect: 'manual', headers: { 'Content-Type': 'application/json', Cookie: `crm_session=${tok}`, ...(init.headers ?? {}) } })

async function main() {
  const { prisma } = await import('../lib/prisma')
  const admin = await prisma.user.findFirst({ where: { email: 'admin@flexxo.com.my' }, select: { id: true, name: true, email: true } })
  if (!admin) throw new Error('no admin')
  const supplier = await prisma.supplier.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!supplier) throw new Error('no supplier')

  const u = { userId: admin.id, name: admin.name, email: admin.email }
  const adminTok = await mint(u, 'Admin')
  const mgrTok = await mint(u, 'Manager')
  const out: string[] = []
  const ok = (l: string, c: boolean, x = '') => out.push(`${c ? '✅' : '❌'} ${l}${x ? ' — ' + x : ''}`)

  // Create + Gate 1 — retry through cold-compile 401/500 on a freshly-reloaded dev route
  const createBody = JSON.stringify({
    name: 'TEST P2 flow', mode: 'multi', items: [{ name: 'A4 Paper', unit: 'REAM', qty: 100, targetPrice: 12 }], vendorSupplierIds: [supplier.id],
  })
  let cr: { id?: string; refNo?: string } = {}
  for (let attempt = 1; attempt <= 4; attempt++) {
    const crRes = await call('/api/tenders', adminTok, { method: 'POST', body: createBody })
    const crText = await crRes.text()
    if (crRes.status === 201) { cr = JSON.parse(crText); break }
    console.log(`create attempt ${attempt}: status ${crRes.status} ${crText.slice(0, 120)}`)
    await new Promise(r => setTimeout(r, 2500))
  }
  const id = cr.id as string
  ok('create', !!id, cr.refNo)
  const g1 = await call(`/api/tenders/${id}/gate1`, mgrTok, { method: 'POST' })
  ok('Gate 1 → rfq', g1.status === 200)

  const vendor = await prisma.tenderVendor.findFirst({ where: { tenderId: id }, select: { id: true, supplierId: true } })
  ok('vendor present', !!vendor)

  // Update reply status → price_received with validity
  const patch = await call(`/api/tenders/${id}/vendors`, adminTok, { method: 'PATCH', body: JSON.stringify({ vendorId: vendor!.id, replyStatus: 'price_received', quoteValidityDays: 30 }) })
  ok('PATCH vendor price_received', patch.status === 200, `status ${patch.status}`)

  // RFQ PDF
  const pdf = await call(`/api/tenders/${id}/rfq-pdf?supplierId=${vendor!.supplierId}`, adminTok)
  const ct = pdf.headers.get('content-type') ?? ''
  const bytes = (await pdf.arrayBuffer()).byteLength
  ok('RFQ PDF', pdf.status === 200 && ct.includes('pdf') && bytes > 1000, `status ${pdf.status}, ${ct}, ${bytes}B`)

  // Add a second vendor
  const s2 = await prisma.supplier.findFirst({ where: { isActive: true, id: { not: supplier.id } }, select: { id: true } })
  if (s2) {
    const add = await call(`/api/tenders/${id}/vendors`, adminTok, { method: 'POST', body: JSON.stringify({ supplierIds: [s2.id] }) })
    ok('POST add vendor', add.status === 200)
  }

  // Gate 2 (no min-quotes set → should pass)
  const g2 = await call(`/api/tenders/${id}/gate2`, mgrTok, { method: 'POST', body: JSON.stringify({}) })
  const g2b = await g2.json().catch(() => ({}))
  ok('Gate 2 → evaluation', g2.status === 200 && g2b.stage === 'evaluation', `status ${g2.status}, stage ${g2b.stage}, qne ${g2b.qneProjectCode ?? 'none'}`)

  // DB asserts
  const t = await prisma.tender.findUnique({ where: { id }, include: { vendors: true, amendments: true } })
  ok('DB stage evaluation', t?.stage === 'evaluation', t?.stage)
  ok('DB gate2 approval id set', !!t?.gate2ApprovalId)
  const v = t?.vendors.find(x => x.id === vendor!.id)
  ok('DB vendor priceReceivedAt set', !!v?.priceReceivedAt)
  ok('DB vendor quoteValidUntil set', !!v?.quoteValidUntil)
  ok('DB amendments ≥2 (gate1+gate2)', (t?.amendments.length ?? 0) >= 2, `${t?.amendments.length}`)
  ok('DB qneProjectCode null (flag off)', t?.qneProjectCode == null)

  // cleanup
  const apprIds = [t?.gate1ApprovalId, t?.gate2ApprovalId].filter(Boolean) as string[]
  await prisma.tender.delete({ where: { id } })
  for (const a of apprIds) await prisma.approvalRequest.delete({ where: { id: a } }).catch(() => {})
  out.push('🧹 cleaned up')

  console.log('\n' + out.join('\n') + '\n')
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
