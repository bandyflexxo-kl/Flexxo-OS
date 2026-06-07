/**
 * scripts/setupDemoAccount.ts
 * Creates a B2B portal demo account for Bandy using direct pg connection.
 * Safe to re-run.
 *
 * Run: npx tsx scripts/setupDemoAccount.ts
 */
import * as dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

import { Client } from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const LOCAL_DB      = 'postgresql://postgres:Flexxo%408820@localhost:5432/flexxo_sales_os'
const DEMO_EMAIL    = 'demo.bandy@flexxo.internal'
const DEMO_PASSWORD = 'DemoPass123!'
const DEMO_NAME     = 'Bandy (Demo Customer)'

async function main() {
  const client = new Client({ connectionString: LOCAL_DB })
  await client.connect()
  console.log('✅ Connected to local PostgreSQL\n=== Flexxo Demo Account Setup ===\n')

  // 1. Find a good demo company
  const compRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM companies WHERE status = 'Active Customer' ORDER BY name ASC LIMIT 10`
  )
  const companies = compRes.rows
  if (companies.length === 0) {
    console.error('❌ No active companies found.')
    await client.end()
    process.exit(1)
  }

  const demoCompany = companies[0]
  console.log(`Demo company: "${demoCompany.name}" (${demoCompany.id})`)
  console.log('\nAll active companies (first 10):')
  companies.forEach(c => console.log(`  - ${c.name}`))

  // 2. Find B2B Client role
  const roleRes = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'B2B Client' LIMIT 1`)
  if (roleRes.rows.length === 0) {
    console.error('❌ B2B Client role not found. Run: npx prisma db seed')
    await client.end()
    process.exit(1)
  }
  const b2bRoleId = roleRes.rows[0].id

  // 3. Check existing
  const existRes = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [DEMO_EMAIL])
  const hash     = await bcrypt.hash(DEMO_PASSWORD, 12)

  if (existRes.rows.length > 0) {
    const userId = existRes.rows[0].id
    await client.query(
      `UPDATE users SET password_hash=$1, is_active=true, must_change_password=false, customer_company_id=$2 WHERE id=$3`,
      [hash, demoCompany.id, userId]
    )
    console.log(`\n✅ Demo account updated: ${DEMO_EMAIL}`)
    console.log(`   Password reset to: ${DEMO_PASSWORD}`)
  } else {
    const userId = randomUUID()
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, is_active, must_change_password, customer_company_id, created_at)
       VALUES ($1,$2,$3,$4,true,false,$5,now())`,
      [userId, DEMO_NAME, DEMO_EMAIL, hash, demoCompany.id]
    )
    // Check if user_roles already exists
    const roleCheck = await client.query(
      `SELECT id FROM user_roles WHERE user_id=$1 AND role_id=$2`,
      [userId, b2bRoleId]
    )
    if (roleCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, granted_at) VALUES ($1,$2,$3,now())`,
        [randomUUID(), userId, b2bRoleId]
      )
    }
    console.log(`\n✅ Demo B2B account created!`)
    console.log(`   Name:     ${DEMO_NAME}`)
    console.log(`   Email:    ${DEMO_EMAIL}`)
    console.log(`   Password: ${DEMO_PASSWORD}`)
    console.log(`   Company:  ${demoCompany.name}`)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 END-TO-END DEMO STEPS')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('STEP 1 — Customer places order:')
  console.log(`  → Open http://localhost:3000/shop/login`)
  console.log(`  → Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log('  → Browse /shop/products → click any product → Add to Cart')
  console.log('  → /shop/cart → Submit Quote Request')
  console.log('  → You land on /shop/quotations/[id] — status: pending_review')
  console.log('')
  console.log('STEP 2 — Admin approves quotation (auto-sends to customer):')
  console.log('  → Open http://localhost:3000 in another tab / incognito')
  console.log('  → Login: admin@flexxo.com.my')
  console.log('  → Go to /quotations → find the new quotation')
  console.log('  → Open it → Add/adjust line items + pricing → click Approve')
  console.log('  → System auto-sends email to customer, status → sent')
  console.log('')
  console.log('STEP 3 — Customer accepts:')
  console.log('  → Back to customer tab → /shop/quotations')
  console.log('  → Open the quotation (status: sent, "Action required" badge)')
  console.log('  → Click ✓ Accept Quotation')
  console.log('  → Order is created: /shop/orders')
  console.log('')
  console.log('STEP 4 — Admin approves order:')
  console.log('  → Admin tab → /orders → find ORD-YYYY-XXXX')
  console.log('  → Click ✓ Approve Order → Invoice + Warehouse task created')
  console.log('')
  console.log('STEP 5 — Warehouse picks:')
  console.log('  → Admin tab → /warehouse → find the picking task')
  console.log('  → Click ✓ Done → Order status: Packed')
  console.log('')
  console.log('STEP 6 — Choose Self-Collection:')
  console.log('  → Admin tab → /orders/[id] → Order Progress panel')
  console.log('  → Click 🏪 Self-Collection → status: ReadyToCollect')
  console.log('  → Salesperson push: "Ready to Collect"')
  console.log('')
  console.log('STEP 7 — Customer collects:')
  console.log('  → Admin tab → Order detail → Click ✅ Confirm Collected')
  console.log('  → Status: Collected, 30-day reorder follow-up created')
  console.log('')
  console.log('STEP 8 — Customer sees it:')
  console.log('  → Customer tab → /shop/orders → Status: "Collected" ✅')
  console.log('  → /shop/orders/[id] → stepper: Confirmed → Processing → Ready to Collect → Collected')
  console.log('')
  console.log('STEP 9 — QNE Sandbox (Principle 10):')
  console.log('  → Admin tab → /admin/qne-sandbox → Invoice staged here')
  console.log('  → Review → Approve → Enter manually in QNE using original date')

  await client.end()
}

main().catch(err => { console.error(err); process.exit(1) })
