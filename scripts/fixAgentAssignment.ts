// ============================================================
// FLEXXO SALES OS — Agent Auto-Assignment Fix
// Drop this file into your project scripts/ folder
// Run: npx ts-node scripts/fixAgentAssignment.ts
// ============================================================
// What this does:
// 1. Fetches all QNE agents via GET /api/Agents
// 2. Fetches all QNE customers via GET /api/Customers
// 3. Matches each customer's agent code to a CRM user
// 4. Creates placeholder users for unmatched agents
// 5. Creates CompanyAssignment records for all matched companies
// 6. Prints a full summary
// ============================================================

import { config } from 'dotenv'
import { resolve }  from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const QNE_BASE = process.env.QNE_API_BASE_URL || 'http://26.255.19.220:82';
const QNE_DB_CODE = process.env.QNE_DB_CODE || 'FKLSB';
const QNE_USERNAME = process.env.QNE_API_USERNAME || 'SALES 6';
const QNE_PASSWORD = process.env.QNE_API_PASSWORD || '12345';

// ── helpers ──────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res = await fetch(`${QNE_BASE}/api/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dbCode: QNE_DB_CODE, userName: QNE_USERNAME, password: QNE_PASSWORD }),
  });
  const data = await res.json() as any;
  const token = data.token || data.Token || data.accessToken || data.AccessToken || '';
  if (!token) throw new Error('Login failed: ' + JSON.stringify(data));
  console.log('✓ QNE login successful');
  return token;
}

async function qneGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${QNE_BASE}${path}`, {
    headers: { 'DbCode': QNE_DB_CODE, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`QNE ${path} returned ${res.status}`);
  return res.json();
}

function normalise(str: string): string {
  return (str || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('../lib/prisma')
  console.log('\n=== FLEXXO — Agent Auto-Assignment Fix ===\n');

  const token = await getToken();

  // 1. Fetch QNE agents
  console.log('Fetching QNE agents...');
  const agentsRaw = await qneGet('/api/Agents', token);
  const agents: any[] = Array.isArray(agentsRaw) ? agentsRaw : agentsRaw?.value || agentsRaw?.data || [];
  console.log(`✓ Found ${agents.length} agents in QNE`);
  if (agents.length > 0) {
    console.log('  Sample agent fields:', Object.keys(agents[0]).join(', '));
    console.log('  First agent:', JSON.stringify(agents[0], null, 2));
  }

  // 2. Fetch QNE customers (to read agent codes)
  console.log('\nFetching QNE customers...');
  const customersRaw = await qneGet('/api/Customers', token);
  const customers: any[] = Array.isArray(customersRaw) ? customersRaw : customersRaw?.value || customersRaw?.data || [];
  console.log(`✓ Found ${customers.length} customers in QNE`);
  if (customers.length > 0) {
    console.log('  Sample customer fields:', Object.keys(customers[0]).join(', '));
    console.log('  First customer agent fields:', JSON.stringify(
      Object.fromEntries(Object.entries(customers[0]).filter(([k]) =>
        k.toLowerCase().includes('agent') || k.toLowerCase().includes('sales') || k.toLowerCase().includes('assign')
      )), null, 2
    ));
  }

  // 3. Build agent code → agent name map from QNE
  // Try common field names for agent code and name
  const agentCodeFields = ['code', 'Code', 'agentCode', 'AgentCode', 'id', 'Id'];
  const agentNameFields = ['name', 'Name', 'agentName', 'AgentName', 'description', 'Description'];

  const getField = (obj: any, fields: string[]) => {
    for (const f of fields) if (obj[f] !== undefined) return String(obj[f]);
    return '';
  };

  const qneAgentMap = new Map<string, string>(); // code → name
  for (const agent of agents) {
    const code = getField(agent, agentCodeFields);
    const name = getField(agent, agentNameFields);
    if (code) qneAgentMap.set(normalise(code), name || code);
  }
  console.log(`\n  Mapped ${qneAgentMap.size} agent codes`);

  // 4. Build customer → agent code map
  const customerAgentFields = ['agentCode', 'AgentCode', 'agent', 'Agent', 'salesAgent', 'SalesAgent', 'salesPerson', 'SalesPerson'];
  const customerCodeFields = ['code', 'Code', 'customerCode', 'CustomerCode', 'debtorCode', 'DebtorCode'];

  const customerAgentMap = new Map<string, string>(); // qneCustomerCode → agentCode
  for (const c of customers) {
    const custCode = getField(c, customerCodeFields);
    const agentCode = getField(c, customerAgentFields);
    if (custCode && agentCode) customerAgentMap.set(custCode, agentCode);
  }
  console.log(`  Customers with agent code: ${customerAgentMap.size} / ${customers.length}`);

  // 5. Get all CRM companies that came from QNE
  const companies = await prisma.company.findMany({
    where: { qneCustomerCode: { not: null } },
    select: { id: true, name: true, qneCustomerCode: true, createdById: true },
  });
  console.log(`\n✓ CRM companies with QNE code: ${companies.length}`);

  // 6. Get existing CRM users
  const crmUsers = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  const crmUserMap = new Map<string, string>(); // normalised name/email → userId
  for (const u of crmUsers) {
    crmUserMap.set(normalise(u.name), u.id);
    crmUserMap.set(normalise(u.email), u.id);
  }

  // 7. Get a system/admin user for created_by fields
  const adminUser = await prisma.user.findFirst({ where: { isActive: true } });
  if (!adminUser) throw new Error('No active user found — run seed first');

  // 8. Process each company
  let matched = 0, unmatched = 0, placeholdersCreated = 0, assignmentsCreated = 0, alreadyAssigned = 0;
  const unmatchedAgents = new Set<string>();
  const createdPlaceholders = new Map<string, string>(); // agentCode → userId

  for (const company of companies) {
    const qneCode = company.qneCustomerCode!;
    const rawAgentCode = customerAgentMap.get(qneCode) || '';
    if (!rawAgentCode) { unmatched++; continue; }

    const normAgent = normalise(rawAgentCode);
    const agentName = qneAgentMap.get(normAgent) || rawAgentCode;

    // Check existing assignment
    const existingAssignment = await prisma.companyAssignment.findFirst({
      where: { companyId: company.id, unassignedAt: null },
    });
    if (existingAssignment) { alreadyAssigned++; continue; }

    // Find or create CRM user for this agent
    let userId = crmUserMap.get(normAgent) || createdPlaceholders.get(normAgent);

    if (!userId) {
      // Try partial match on name
      for (const [key, id] of crmUserMap.entries()) {
        if (key.includes(normAgent) || normAgent.includes(key)) {
          userId = id;
          break;
        }
      }
    }

    if (!userId) {
      // Create placeholder user
      const placeholderEmail = `${rawAgentCode.toLowerCase().replace(/\s+/g, '.')}@flexxo.internal`;
      try {
        const newUser = await prisma.user.create({
          data: {
            name: agentName,
            email: placeholderEmail,
            passwordHash: 'placeholder-needs-reset',
            isActive: true,
          },
        });
        userId = newUser.id;
        createdPlaceholders.set(normAgent, userId);
        crmUserMap.set(normAgent, userId);
        placeholdersCreated++;
        console.log(`  + Created placeholder user: ${agentName} (${placeholderEmail})`);

        // Assign Salesperson role
        const salesRole = await prisma.role.findFirst({ where: { name: 'Salesperson' } });
        if (salesRole) {
          await prisma.userRole.create({ data: { userId, roleId: salesRole.id } });
        }
      } catch (e: any) {
        if (e.code === 'P2002') {
          // Email already exists — find the user
          const existing = await prisma.user.findUnique({ where: { email: `${rawAgentCode.toLowerCase().replace(/\s+/g, '.')}@flexxo.internal` } });
          if (existing) { userId = existing.id; createdPlaceholders.set(normAgent, userId); }
        }
      }
    }

    if (userId) {
      await prisma.companyAssignment.create({
        data: {
          companyId: company.id,
          userId,
          roleInAccount: 'Primary',
          isPrimary: true,
        },
      });
      assignmentsCreated++;
      matched++;
    } else {
      unmatched++;
      unmatchedAgents.add(rawAgentCode);
    }
  }

  // 9. Summary
  console.log('\n=== ASSIGNMENT SUMMARY ===');
  console.log(`QNE agents found:          ${agents.length}`);
  console.log(`CRM companies processed:   ${companies.length}`);
  console.log(`Already assigned:          ${alreadyAssigned}`);
  console.log(`Successfully matched:      ${matched}`);
  console.log(`Assignments created:       ${assignmentsCreated}`);
  console.log(`Placeholder users created: ${placeholdersCreated}`);
  console.log(`Unmatched (no agent code): ${unmatched}`);
  if (unmatchedAgents.size > 0) {
    console.log(`Unmatched agent codes:     ${[...unmatchedAgents].join(', ')}`);
  }
  console.log('==========================\n');
  console.log('Done. Go to /companies in your CRM to verify assignments.');
}

main().catch(e => { console.error('Error:', e); process.exit(1) })
