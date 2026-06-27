/**
 * End-to-end smoke test for the Phase-1 tender flow against the running dev
 * server (http://localhost:3000). Mints crm_session JWTs (same secret as the
 * app) for an Admin and a Manager, then exercises: list → create → detail →
 * schedule xlsx → Gate 1 (403 for Admin, 200 for Manager). Cleans up after.
 *
 * Run: npx tsx scripts/_verifyTenderFlow.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { SignJWT } from 'jose'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000'

async function mint(user: { userId: string; name: string; email: string }, role: string): Promise<string> {
  const secret = process.env.SESSION_SECRET ?? process.env.NEXTAUTH_SECRET
  const key = new TextEncoder().encode(secret)
  return new SignJWT({
    userId: user.userId, name: user.name, email: user.email, role,
    mustChangePassword: false, expiresAt: new Date(Date.now() + 86400000).toISOString(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key)
}

function call(path: string, token: string, init: RequestInit = {}) {
  return fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: `crm_session=${token}`, ...(init.headers ?? {}) },
    redirect: 'manual',
  })
}

async function main() {
  const { prisma } = await import('../lib/prisma')

  const admin = await prisma.user.findFirst({ where: { email: 'admin@flexxo.com.my' }, select: { id: true, name: true, email: true } })
  if (!admin) throw new Error('admin user not found')
  const supplier = await prisma.supplier.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
  if (!supplier) throw new Error('no supplier found')

  const adminTok   = await mint({ userId: admin.id, name: admin.name, email: admin.email }, 'Admin')
  const managerTok = await mint({ userId: admin.id, name: admin.name, email: admin.email }, 'Manager')

  const results: string[] = []
  const ok = (label: string, cond: boolean, extra = '') => results.push(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)

  // 1. List (authed)
  const list = await call('/tenders', adminTok)
  ok('GET /tenders (authed)', list.status === 200, `status ${list.status}`)

  // 2. Create
  const createRes = await call('/api/tenders', adminTok, {
    method: 'POST',
    body: JSON.stringify({
      name: 'TEST — verify tender flow', mode: 'multi',
      estValue: 12345.67,
      submissionExpiry: new Date(Date.now() + 5 * 86400000).toISOString(),
      items: [
        { name: 'A4 Paper 80gsm', unit: 'REAM', qty: 100, targetPrice: 12.5 },
        { name: 'Ballpoint pen blue', unit: 'BOX', qty: 50 },
      ],
      vendorSupplierIds: [supplier.id],
    }),
  })
  const created = await createRes.json().catch(() => ({}))
  ok('POST /api/tenders (create)', createRes.status === 201 && !!created.id, `status ${createRes.status}, ref ${created.refNo ?? '?'}`)
  const tenderId = created.id as string
  if (!tenderId) { console.log(results.join('\n')); throw new Error('create failed, aborting') }

  // 3. Detail
  const detail = await call(`/tenders/${tenderId}`, adminTok)
  ok('GET /tenders/[id] (detail)', detail.status === 200, `status ${detail.status}`)

  // 4. Schedule xlsx
  const sched = await call(`/api/tenders/${tenderId}/schedule`, adminTok)
  const ct = sched.headers.get('content-type') ?? ''
  ok('GET schedule.xlsx', sched.status === 200 && ct.includes('spreadsheet'), `status ${sched.status}, ${ct.slice(0, 40)}`)

  // 5. Gate 1 as Admin → 403
  const gateAdmin = await call(`/api/tenders/${tenderId}/gate1`, adminTok, { method: 'POST' })
  ok('Gate 1 as Admin blocked', gateAdmin.status === 403, `status ${gateAdmin.status}`)

  // 6. Gate 1 as Manager → 200, stage rfq
  const gateMgr = await call(`/api/tenders/${tenderId}/gate1`, managerTok, { method: 'POST' })
  const gateBody = await gateMgr.json().catch(() => ({}))
  ok('Gate 1 as Manager ok', gateMgr.status === 200 && gateBody.stage === 'rfq', `status ${gateMgr.status}, stage ${gateBody.stage}`)

  // 7. DB assertions
  const t = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { items: true, vendors: true, amendments: true },
  })
  ok('DB: stage advanced to rfq', t?.stage === 'rfq', t?.stage)
  ok('DB: items persisted', t?.items.length === 2, `${t?.items.length} items`)
  ok('DB: vendor invited', t?.vendors.length === 1, `${t?.vendors.length} vendors`)
  ok('DB: amendment logged (stage)', (t?.amendments.length ?? 0) >= 1, `${t?.amendments.length} amendments`)
  const approval = t?.gate1ApprovalId ? await prisma.approvalRequest.findUnique({ where: { id: t.gate1ApprovalId } }) : null
  ok('DB: Gate-1 approval approved', approval?.status === 'approved', approval?.status)
  const audit = await prisma.auditLog.count({ where: { tableName: 'tenders', recordId: tenderId } })
  ok('DB: audit trigger fired', audit >= 1, `${audit} audit rows`)

  // Cleanup
  await prisma.tender.delete({ where: { id: tenderId } }) // cascades items/vendors/amendments
  if (t?.gate1ApprovalId) await prisma.approvalRequest.delete({ where: { id: t.gate1ApprovalId } }).catch(() => {})
  results.push('🧹 cleaned up test tender')

  console.log('\n' + results.join('\n') + '\n')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
