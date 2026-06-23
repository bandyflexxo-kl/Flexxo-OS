import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

async function main() {
  // 1. Brand pref rules
  const rules = await prisma.productBrandPreference.findMany({ where: { isActive: true } })
  console.log('\n=== Brand Preference Rules ===')
  for (const r of rules) {
    console.log(`  [${r.label}] keywords="${r.keywords}" brands="${r.brands}" boost=${r.boostMultiplier}`)
  }
  console.log(`  Total: ${rules.length} active rules`)

  // 2. Ruler products
  const rulers = await prisma.product.findMany({
    where: { isActive: true, name: { contains: 'ruler', mode: 'insensitive' } },
    select: { name: true, brand: true, qneAvailableQty: true, isVisibleToCustomers: true, qneInvoiceFreq: true },
    take: 8,
  })
  console.log('\n=== Ruler Products (first 8) ===')
  for (const p of rulers) {
    console.log(`  "${p.name}" brand=${p.brand} stock=${p.qneAvailableQty} visible=${p.isVisibleToCustomers} freq=${p.qneInvoiceFreq}`)
  }

  // 3. APLUS 2B pencil products
  const pencils = await prisma.product.findMany({
    where: { isActive: true, name: { contains: '2B', mode: 'insensitive' }, brand: { contains: 'APLUS', mode: 'insensitive' } },
    select: { name: true, brand: true, qneAvailableQty: true, isVisibleToCustomers: true, qneInvoiceFreq: true },
    take: 5,
  })
  console.log('\n=== APLUS 2B Pencil Products ===')
  for (const p of pencils) {
    console.log(`  "${p.name}" brand=${p.brand} stock=${p.qneAvailableQty} visible=${p.isVisibleToCustomers} freq=${p.qneInvoiceFreq}`)
  }

  // 4. EMAS pencil products
  const emas = await prisma.product.findMany({
    where: { isActive: true, name: { contains: 'pencil', mode: 'insensitive' }, brand: { contains: 'EMAS', mode: 'insensitive' } },
    select: { name: true, brand: true, qneAvailableQty: true, isVisibleToCustomers: true, qneInvoiceFreq: true },
    take: 5,
  })
  console.log('\n=== EMAS Pencil Products ===')
  for (const p of emas) {
    console.log(`  "${p.name}" brand=${p.brand} stock=${p.qneAvailableQty} visible=${p.isVisibleToCustomers} freq=${p.qneInvoiceFreq}`)
  }

  // 5. Category check for pencils
  const cat = await prisma.product.findFirst({
    where: { isActive: true, name: { contains: 'pencil', mode: 'insensitive' } },
    select: { name: true, category: { select: { name: true, parentCategory: { select: { name: true } } } } },
  })
  console.log('\n=== Sample Pencil Category ===')
  console.log(`  "${cat?.name}" → sub: ${cat?.category.name} → parent: ${cat?.category.parentCategory?.name}`)

  await prisma.$disconnect()
}
main().catch(console.error)
