// ============================================================
// FLEXXO SALES OS — Sync Agent Emails from QNE to CRM
// Run: npx ts-node scripts/syncAgentEmails.ts
// ============================================================
// What this does:
// 1. Fetches all agents from QNE via GET /api/Agents
// 2. Prints ALL fields found — so you can see if email exists
// 3. If email fields are found → matches agents to CRM users
//    and updates their email address automatically
// 4. If no email in QNE → prints a mapping table so you know
//    which CRM account to update manually via /admin/users
// ============================================================

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const QNE_BASE     = process.env.QNE_API_BASE_URL  || 'http://26.255.19.220:82'
const QNE_DB_CODE  = process.env.QNE_DB_CODE       || 'FKLSB'
const QNE_USERNAME = process.env.QNE_API_USERNAME  || 'SALES 6'
const QNE_PASSWORD = process.env.QNE_API_PASSWORD  || '12345'

// ── helpers ────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res  = await fetch(`${QNE_BASE}/api/Users/Login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dbCode: QNE_DB_CODE, userName: QNE_USERNAME, password: QNE_PASSWORD }),
  })
  const data = await res.json() as Record<string, unknown>
  const token = (data.token || data.Token || data.accessToken || data.AccessToken || '') as string
  if (!token) throw new Error('QNE login failed: ' + JSON.stringify(data))
  console.log('✓ QNE login successful\n')
  return token
}

async function qneGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${QNE_BASE}${path}`, {
    headers: { 'DbCode': QNE_DB_CODE, 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`QNE ${path} returned ${res.status}`)
  return res.json()
}

function normalise(str: string): string {
  return (str || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
}

function getField(obj: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    if (obj[f] !== undefined && obj[f] !== null && String(obj[f]).trim() !== '') {
      return String(obj[f]).trim()
    }
  }
  return ''
}

// ── main ───────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('../lib/prisma')
  console.log('=== FLEXXO — Sync Agent Emails from QNE ===\n')

  const token = await getToken()

  // 1. Fetch agents from QNE
  console.log('Fetching agents from QNE...')
  const agentsRaw = await qneGet('/api/Agents', token) as Record<string, unknown>
  const agents: Record<string, unknown>[] = Array.isArray(agentsRaw)
    ? agentsRaw
    : (agentsRaw?.value || agentsRaw?.data || []) as Record<string, unknown>[]

  console.log(`✓ Found ${agents.length} agents in QNE\n`)

  if (agents.length === 0) {
    console.log('No agents returned from QNE. Check VPN connection.')
    process.exit(1)
  }

  // 2. Print all fields on the first agent — so we know what's available
  console.log('━━━ ALL FIELDS on QNE Agent records ━━━')
  console.log('Fields:', Object.keys(agents[0]).join(', '))
  console.log('\nFirst agent (full record):')
  console.log(JSON.stringify(agents[0], null, 2))
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // 3. Check which fields exist
  const emailFieldAliases  = ['email', 'Email', 'emailAddress', 'EmailAddress', 'email1', 'Email1']
  const mobileFieldAliases = ['mobileNo', 'MobileNo', 'mobile', 'Mobile', 'mobilePhone', 'phone', 'Phone', 'phoneNo']
  const nameFieldAliases   = ['name', 'Name', 'agentName', 'AgentName', 'description', 'Description', 'staffName', 'StaffName']
  const codeFieldAliases   = ['code', 'Code', 'agentCode', 'AgentCode', 'staffCode', 'StaffCode', 'id', 'Id']

  const sampleAgent        = agents[0]
  const foundEmailField    = emailFieldAliases.find(f => sampleAgent[f] !== undefined)
  const foundMobileField   = mobileFieldAliases.find(f => sampleAgent[f] !== undefined)

  // 4. Get all CRM users
  const crmUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, mobileNo: true },
    orderBy: { name: 'asc' },
  })

  // Build normalised name → userId map
  const crmUserByName = new Map<string, typeof crmUsers[0]>()
  for (const u of crmUsers) {
    crmUserByName.set(normalise(u.name), u)
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  console.log(`Email field in QNE: ${foundEmailField  ? `"${foundEmailField}"`  : 'NOT FOUND'}`)
  console.log(`Mobile field in QNE: ${foundMobileField ? `"${foundMobileField}"` : 'NOT FOUND'}\n`)

  if (!foundEmailField && !foundMobileField) {
    // ── Nothing to sync ──────────────────────────────────────────
    console.log('⚠  QNE agent records have no email or mobile fields.')
    console.log('   Update manually via /admin/users → Edit button.\n')

    console.log('Name'.padEnd(20) + 'Current CRM Email'.padEnd(35) + 'Needs Update?')
    console.log('─'.repeat(70))
    for (const u of crmUsers) {
      const isPlaceholder = u.email.endsWith('@flexxo.internal')
      console.log(
        u.name.padEnd(20) +
        u.email.padEnd(35) +
        (isPlaceholder ? '⚠  YES — placeholder email' : '✓  looks OK')
      )
    }
    console.log('\nTo update: go to http://localhost:3000/admin/users → click "Edit" on each user')

  } else {
    // ── QNE HAS data to sync ─────────────────────────────────────
    console.log('Matching agents to CRM users and syncing...\n')

    let emailUpdated  = 0
    let mobileUpdated = 0
    let skipped       = 0
    let noMatch       = 0

    console.log('Agent Name'.padEnd(20) + 'Email'.padEnd(30) + 'Mobile'.padEnd(20) + 'Action')
    console.log('─'.repeat(85))

    for (const agent of agents) {
      const agentName   = getField(agent as Record<string, unknown>, nameFieldAliases)
      const agentCode   = getField(agent as Record<string, unknown>, codeFieldAliases)
      const agentEmail  = foundEmailField  ? getField(agent as Record<string, unknown>, emailFieldAliases)  : ''
      const agentMobile = foundMobileField ? getField(agent as Record<string, unknown>, mobileFieldAliases) : ''
      const displayName = agentName || agentCode || 'Unknown'

      if (!agentEmail && !agentMobile) {
        console.log(displayName.padEnd(20) + '—'.padEnd(30) + '—'.padEnd(20) + 'no data, skipped')
        skipped++
        continue
      }

      // Match to CRM user by name
      const normName = normalise(agentName || agentCode)
      let crmUser = crmUserByName.get(normName)

      if (!crmUser) {
        for (const [key, u] of crmUserByName.entries()) {
          if (key.includes(normName) || normName.includes(key)) {
            crmUser = u
            break
          }
        }
      }

      if (!crmUser) {
        console.log(displayName.padEnd(20) + (agentEmail || '—').padEnd(30) + (agentMobile || '—').padEnd(20) + '✗ no CRM user')
        noMatch++
        continue
      }

      const updates: { email?: string; mobileNo?: string } = {}
      const actions: string[] = []

      if (agentEmail && agentEmail !== crmUser.email) {
        updates.email = agentEmail
        actions.push(`email → ${agentEmail}`)
        emailUpdated++
      }
      if (agentMobile && agentMobile !== crmUser.mobileNo) {
        updates.mobileNo = agentMobile
        actions.push(`mobile → ${agentMobile}`)
        mobileUpdated++
      }

      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: crmUser.id }, data: updates })
        console.log(displayName.padEnd(20) + (agentEmail || '—').padEnd(30) + (agentMobile || '—').padEnd(20) + '✓ ' + actions.join(', '))
      } else {
        console.log(displayName.padEnd(20) + (agentEmail || '—').padEnd(30) + (agentMobile || '—').padEnd(20) + '✓ already up to date')
        skipped++
      }
    }

    console.log('\n━━━ SUMMARY ━━━')
    console.log(`Emails updated:  ${emailUpdated}`)
    console.log(`Mobiles updated: ${mobileUpdated}`)
    console.log(`Already in sync: ${skipped}`)
    console.log(`No CRM match:    ${noMatch}`)
  }

  console.log('\n=== DONE ===\n')
}

main().catch(e => { console.error('\nError:', e.message); process.exit(1) })
