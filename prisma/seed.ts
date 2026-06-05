// ============================================================
// FLEXXO SALES OS — PRISMA SEED FILE
// Creates: roles, pipeline stages, product categories, admin user
// Run: npx prisma db seed
// ============================================================

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { PrismaClient } from '../app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding Flexxo Sales OS...')

  // --- Roles ---
  const roles = ['Admin', 'Manager', 'Salesperson', 'Viewer', 'B2B Client', 'Warehouse']
  for (const name of roles) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }
  console.log('✓ Roles seeded')

  // --- Pipeline Stage Definitions ---
  const stages = [
    { name: 'New Lead',                   sortOrder: 1,  colorHex: '#94A3B8' },
    { name: 'Contacted',                  sortOrder: 2,  colorHex: '#60A5FA' },
    { name: 'Company Profile Sent',       sortOrder: 3,  colorHex: '#34D399' },
    { name: 'Catalog Sent',               sortOrder: 4,  colorHex: '#A78BFA' },
    { name: 'Need Identified',            sortOrder: 5,  colorHex: '#F59E0B' },
    { name: 'Quotation Sent',             sortOrder: 6,  colorHex: '#F97316' },
    { name: 'Follow-Up',                  sortOrder: 7,  colorHex: '#EC4899' },
    { name: 'Won / Active Customer',      sortOrder: 8,  colorHex: '#10B981' },
    { name: 'Repeat Order / Key Account', sortOrder: 9,  colorHex: '#059669' },
    { name: 'Lost / Dormant',             sortOrder: 10, colorHex: '#6B7280' },
    { name: 'Vendor Registration Required', sortOrder: 11, colorHex: '#7C3AED' },
    { name: 'Vendor Form Submitted',        sortOrder: 12, colorHex: '#8B5CF6' },
    { name: 'Awaiting Vendor Approval',     sortOrder: 13, colorHex: '#A78BFA' },
    { name: 'Approved Vendor',              sortOrder: 14, colorHex: '#6D28D9' },
  ]
  for (const stage of stages) {
    await prisma.pipelineStageDefinition.upsert({
      where: { name: stage.name },
      update: {},
      create: stage,
    })
  }
  console.log('✓ Pipeline stages seeded')

  // --- Product Categories ---
  const categories = [
    { name: 'Battery',              slug: 'battery' },
    { name: 'Corporate Gift',       slug: 'corporate-gift' },
    { name: 'Office Food & Pantry', slug: 'office-food-pantry' },
    { name: 'Office Machine',       slug: 'office-machine' },
    { name: 'Office Stationery',    slug: 'office-stationery' },
    { name: 'Hygiene & Cleaning',   slug: 'hygiene-cleaning' },
    { name: 'Printer Consumables',  slug: 'printer-consumables' },
    { name: 'Furniture',            slug: 'furniture' },
    { name: 'Thermal Roll',         slug: 'thermal-roll' },
    { name: 'Paper',                slug: 'paper' },
    { name: 'Safety & PPE',         slug: 'safety-ppe' },
    { name: 'Other',                slug: 'other' },
  ]
  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    })
  }
  console.log('✓ Product categories seeded')

  // --- Admin user ---
  const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } })
  const passwordHash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD || 'ChangeMe123!', 12)
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@flexxo.com.my' },
    update: {},
    create: {
      name: 'System Admin',
      email: process.env.ADMIN_EMAIL || 'admin@flexxo.com.my',
      passwordHash,
      isActive: true,
    },
  })
  if (adminRole) {
    const existing = await prisma.userRole.findFirst({
      where: { userId: admin.id, roleId: adminRole.id },
    })
    if (!existing) {
      await prisma.userRole.create({
        data: { userId: admin.id, roleId: adminRole.id },
      })
    }
  }
  console.log('✓ Admin user seeded')

  // --- System Settings ---
  const systemSettings = [
    { key: 'default_margin_pct', value: '30' },   // internal quotation builder default
    { key: 'retail_margin_pct',  value: '30' },   // shop guest price (global, no overrides)
    { key: 'b2b_margin_pct',     value: '20' },   // shop B2B price (hierarchy: product→category→this)
  ]
  for (const s of systemSettings) {
    await prisma.systemSetting.upsert({
      where:  { key: s.key },
      update: {},
      create: s,
    })
  }
  console.log('✓ System settings seeded (retail: 30%, B2B: 20%)')

  console.log('\nSeed complete. Login: ' + (process.env.ADMIN_EMAIL || 'admin@flexxo.com.my'))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
