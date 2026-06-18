/**
 * Pulls KT Ultimate Advisory's recent invoice history from QNE and creates
 * matching orders in Production testing company.
 * Requires Radmin VPN (Flexxokl) to be active.
 * Run: npx tsx scripts/_pullKtFromQne.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const rawUrl   = process.env.QNE_API_URL ?? 'http://26.255.19.220:82/api'
  const QNE_BASE = rawUrl.replace(/\/api\/?$/, '')
  const QNE_API  = `${QNE_BASE}/api`
  const DB_CODE  = process.env.QNE_DB_CODE ?? 'FKLSB'
  const USERNAME = process.env.QNE_USERNAME ?? 'SALES 6'
  const PASSWORD = process.env.QNE_PASSWORD ?? '12345'

  console.log('Connecting to QNE at', QNE_API)

  const loginRes  = await fetch(`${QNE_API}/Users/Login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', DbCode: DB_CODE },
    body: JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(8000),
  })
  if (!loginRes.ok) { console.log('QNE login failed:', loginRes.status); return }
  const loginData = await loginRes.json() as { token?: string; accessToken?: string }
  const token     = loginData.token ?? loginData.accessToken ?? ''
  if (!token) { console.log('No token'); return }
  console.log('QNE login OK ✅\n')

  const headers = { Authorization: `Bearer ${token}`, DbCode: DB_CODE, 'Content-Type': 'application/json' }

  // ── Get all customers, find KT ─────────────────────────────────────
  const custRes  = await fetch(`${QNE_API}/Customers`, { headers })
  const custRaw  = await custRes.json()
  const customers: Record<string, string>[] = Array.isArray(custRaw)
    ? custRaw : Object.values(custRaw as Record<string, Record<string, string>>)

  const kt = customers.find(c => {
    const name = (c.companyName ?? c.name ?? '').toUpperCase()
    return name.includes('KT ULTIMATE')
  })
  if (!kt) { console.log('KT Ultimate Advisory not found in QNE'); return }

  const ktId   = kt.id
  const ktCode = kt.companyCode
  console.log(`Found: ${kt.companyName} | Code: ${ktCode} | ID: ${ktId}`)

  // ── Fetch KT's invoices (last 10, skip quotation references) ──────
  // QNE API ignores customerCode filter — fetch all and filter client-side by customer field
  const invRes  = await fetch(`${QNE_API}/SalesInvoices?pageSize=200`, { headers })
  const invRaw  = await invRes.json()
  const allInvs: Record<string, unknown>[] = Array.isArray(invRaw)
    ? invRaw : Object.values(invRaw as Record<string, Record<string, unknown>>)

  // Filter: must be KT's invoices (customer code = ktCode) and not quotation references
  const invoices = allInvs
    .filter(inv => {
      const custCode = String(inv.customer ?? inv.customerCode ?? '')
      const custName = String(inv.customerName ?? '').toUpperCase()
      const docNo    = String(inv.invoiceCode ?? inv.docNo ?? '')
      const isKt     = custCode === ktCode || custName.includes('KT ULTIMATE')
      const isInvoice = docNo.toUpperCase().startsWith('INV')
      return isKt && isInvoice
    })
    .slice(0, 10)

  console.log(`Using ${invoices.length} invoices (filtered from ${allInvs.length})\n`)

  // Inspect first invoice to understand structure
  if (invoices.length > 0) {
    console.log('First invoice keys:', Object.keys(invoices[0]))
    console.log('First invoice sample:', JSON.stringify(invoices[0]).slice(0, 400), '\n')
  }

  // ── Get Production testing + Dummy user ───────────────────────────
  const { prisma } = await import('@/lib/prisma')
  const targetCompany = await prisma.company.findFirst({ where: { name: 'Production testing' } })
  const dummyUser     = await prisma.user.findFirst({ where: { email: 'dummy@test.flexxo' } })
  const admin         = await prisma.user.findFirst({ where: { email: 'admin@flexxo.com.my' }, select: { id: true } })
  if (!targetCompany || !dummyUser || !admin) { console.log('Missing CRM setup data'); return }

  // ── Clean existing test orders ─────────────────────────────────────
  const prev = await prisma.order.findMany({ where: { companyId: targetCompany.id } })
  for (const o of prev) {
    await prisma.orderItem.deleteMany({ where: { orderId: o.id } })
    await prisma.order.delete({ where: { id: o.id } })
  }
  const prevQts = await prisma.quotation.findMany({
    where: { companyId: targetCompany.id, status: { not: 'cart' } },
  })
  for (const q of prevQts) {
    await prisma.quotationItem.deleteMany({ where: { quotationId: q.id } })
    await prisma.quotation.delete({ where: { id: q.id } })
  }
  console.log(`Cleared ${prev.length} old orders, ${prevQts.length} quotations\n`)

  const year = new Date().getFullYear()
  let ordNum = await prisma.order.count()
  let qtNum  = await prisma.quotation.count({ where: { status: { not: 'cart' } } })
  let created = 0

  for (const inv of invoices) {
    const invId  = inv.id as string
    const docNo  = (inv.invoiceCode ?? inv.docNo ?? inv.referenceNo ?? invId) as string
    const total  = Number(inv.totalAmount ?? inv.totalAmt ?? inv.amount ?? 0)

    // Fetch full invoice detail for line items
    const detailRes = await fetch(`${QNE_API}/SalesInvoices/${encodeURIComponent(invId)}`, { headers })
    if (!detailRes.ok) {
      console.log(`  Skipping ${docNo} — detail fetch failed (${detailRes.status})`)
      continue
    }
    const detail = await detailRes.json() as Record<string, unknown>

    // Line items may be under different keys — probe
    const lineItems: Record<string, unknown>[] = (
      Array.isArray(detail.items)      ? detail.items :
      Array.isArray(detail.details)    ? detail.details :
      Array.isArray(detail.lineItems)  ? detail.lineItems :
      Array.isArray(detail.stockItems) ? detail.stockItems :
      []
    ) as Record<string, unknown>[]

    if (lineItems.length === 0) {
      // Print detail keys to understand structure
      console.log(`  ${docNo}: no items found. Detail keys: ${Object.keys(detail).join(', ')}`)
      continue
    }

    qtNum++
    ordNum++
    const refQT  = `QT-${year}-KT-${String(qtNum).padStart(4, '0')}`
    const refORD = `ORD-${year}-KT-${String(ordNum).padStart(4, '0')}`

    let subtotal = 0
    const itemRows: { productId: string | null; desc: string; qty: number; unitPrice: number; lineTotal: number }[] = []

    for (const item of lineItems) {
      const itemCode = String(item.stock ?? item.itemCode ?? item.stockCode ?? item.code ?? '')
      const desc     = String(item.description ?? item.itemName ?? item.name ?? itemCode)
      const qty      = Number(item.qty ?? item.quantity ?? 1)
      const price    = Number(item.unitPrice ?? item.sellingPrice ?? item.unitAmt ?? 0)
      const lTotal   = Number(item.lineTotal ?? item.amount ?? price * qty)
      subtotal      += lTotal

      // Match to CRM product by QNE item code
      const product = itemCode
        ? await prisma.product.findFirst({ where: { qneItemCode: itemCode }, select: { id: true } })
        : null

      itemRows.push({ productId: product?.id ?? null, desc, qty, unitPrice: price, lineTotal: lTotal })
    }

    const quotation = await prisma.quotation.create({
      data: {
        companyId:     targetCompany.id,
        createdById:   admin.id,
        referenceNo:   refQT,
        status:        'accepted',
        currency:      'MYR',
        versionNumber: 1,
        subtotal:      total > 0 ? total : subtotal,
        totalAmount:   total > 0 ? total : subtotal,
        internalNotes: `Duplicated from QNE invoice ${docNo}`,
      },
    })

    const qtItemIds: string[] = []
    for (let j = 0; j < itemRows.length; j++) {
      const row = itemRows[j]
      const qi  = await prisma.quotationItem.create({
        data: {
          quotationId: quotation.id,
          productId:   row.productId,
          description: row.desc,
          qty:         row.qty,
          unitCost:    Math.round(row.unitPrice * 0.77 * 100) / 100,
          unitPrice:   row.unitPrice,
          marginPct:   0.30,
          lineTotal:   row.lineTotal,
          sortOrder:   j,
        },
      })
      qtItemIds.push(qi.id)
    }

    const order = await prisma.order.create({
      data: {
        companyId:        targetCompany.id,
        quotationId:      quotation.id,
        createdById:      dummyUser.id,
        referenceNo:      refORD,
        status:           'delivered',
        qneInvoiceRef:    docNo,
      },
    })

    for (let j = 0; j < itemRows.length; j++) {
      const row = itemRows[j]
      await prisma.orderItem.create({
        data: {
          orderId:         order.id,
          productId:       row.productId,
          quotationItemId: qtItemIds[j],
          qty:             row.qty,
          unitPrice:       row.unitPrice,
          lineTotal:       row.lineTotal,
        },
      })
    }

    const matched = itemRows.filter(r => r.productId).length
    console.log(`  ✅ ${docNo} → ${refORD} | ${itemRows.length} items (${matched} matched to CRM products) | MYR ${(total || subtotal).toFixed(2)}`)
    itemRows.forEach(r => console.log(`     • ${r.desc} × ${r.qty} @ RM${r.unitPrice} ${r.productId ? '✓' : '(no CRM match)'}`))
    created++
  }

  console.log(`\n✅ Duplicated ${created} real KT Ultimate Advisory invoices → Production testing`)
  console.log('\nLogin: http://localhost:3000/shop/login')
  console.log('Email: dummy@test.flexxo | Password: Test1234!')
  console.log('Go to /shop/orders → click Reorder on any order')
}

main()
  .then(() => { console.log('\nDone.'); process.exit(0) })
  .catch(e => { console.error('Error:', e.message); process.exit(1) })
