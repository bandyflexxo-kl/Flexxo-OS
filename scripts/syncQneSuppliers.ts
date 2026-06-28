/**
 * syncQneSuppliers.ts — READ-ONLY sync of QNE Suppliers → local `suppliers`.
 *
 * Pulls GET /api/Suppliers and upserts into the CRM by qneSupplierCode. Stores
 * the QNE company code (e.g. 800-R003) so the tender module can invite real
 * vendors AND (later) target QNE PO/GRN writes. NEVER writes to QNE.
 *
 * Run: npx tsx scripts/syncQneSuppliers.ts
 * Requires: Radmin VPN connected to Flexxokl.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

type QneSupplier = {
  companyCode?: string
  companyName?: string
  registrationNo?: string
  term?: string
  currency?: string
  isSuspended?: boolean
  contactPerson?: string
  phoneNo1?: string
  email?: string
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { qneLogin, qneGet } = await import('../lib/qneClient')

  console.log('Logging in to QNE…')
  const token = await qneLogin()
  console.log('Fetching suppliers…')
  const suppliers = await qneGet<QneSupplier[]>('/Suppliers', token)
  console.log(`QNE returned ${suppliers.length} suppliers`)

  let created = 0, updated = 0, skipped = 0, contacts = 0
  for (const s of suppliers) {
    const code = s.companyCode?.trim()
    const name = (s.companyName ?? code ?? '').trim()
    if (!code || !name) { skipped++; continue }

    const data = {
      name,
      nameNormalized: name.toLowerCase().replace(/\s+/g, ' ').trim(),
      regNumber:   s.registrationNo?.trim() || null,
      paymentTerm: s.term?.trim() || null,
      currency:    s.currency?.trim() || 'MYR',
      isActive:    !s.isSuspended,
      qneSyncedAt: new Date(),
    }

    const existing = await prisma.supplier.findUnique({ where: { qneSupplierCode: code }, select: { id: true } })
    let supplierId: string
    if (existing) {
      await prisma.supplier.update({ where: { id: existing.id }, data })
      supplierId = existing.id
      updated++
    } else {
      const c = await prisma.supplier.create({ data: { ...data, qneSupplierCode: code } })
      supplierId = c.id
      created++
    }

    // Best-effort primary contact (only if QNE has one and we have none yet)
    const cp = s.contactPerson?.trim()
    if (cp) {
      const has = await prisma.supplierContact.findFirst({ where: { supplierId }, select: { id: true } })
      if (!has) {
        await prisma.supplierContact.create({
          data: { supplierId, name: cp, email: s.email?.trim() || null, phone: s.phoneNo1?.trim() || null, isPrimary: true },
        })
        contacts++
      }
    }
  }

  const total = await prisma.supplier.count()
  console.log(`\nDone. created ${created}, updated ${updated}, skipped ${skipped}, primary contacts added ${contacts}.`)
  console.log(`Local suppliers table now holds ${total} rows.`)
}

main().then(() => process.exit(0)).catch(e => { console.error('SYNC FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
