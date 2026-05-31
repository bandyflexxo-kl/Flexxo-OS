// ============================================================
// FLEXXO — QNE Field Inspector
// Prints the FULL raw response for:
//   - First customer from GET /api/Customers
//   - First customer from GET /api/Customers/{id} (detail)
//   - First agent from GET /api/Agents
//   - First agent from GET /api/Agents/{id} (detail)
// So we can find the exact field name that links customer to agent
// ============================================================
// Run: npx ts-node scripts/inspectQneFields.ts
// ============================================================

const QNE_BASE = process.env.QNE_API_BASE_URL || 'http://26.255.19.220:82';
const QNE_DB_CODE = process.env.QNE_DB_CODE || 'FKLSB';
const QNE_USERNAME = process.env.QNE_API_USERNAME || 'SALES 6';
const QNE_PASSWORD = process.env.QNE_API_PASSWORD || '12345';

async function getToken(): Promise<string> {
  const res = await fetch(`${QNE_BASE}/api/Users/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dbCode: QNE_DB_CODE,
      userName: QNE_USERNAME,
      password: QNE_PASSWORD,
    }),
  });
  const data = await res.json() as any;
  const token = data.token || data.Token || data.accessToken || data.AccessToken || '';
  if (!token) throw new Error('Login failed: ' + JSON.stringify(data));
  console.log('✓ Login successful\n');
  return token;
}

async function qneGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${QNE_BASE}${path}`, {
    headers: {
      'DbCode': QNE_DB_CODE,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('=== QNE FIELD INSPECTOR ===\n');

  const token = await getToken();

  // ── 1. GET /api/Agents (list) ──────────────────────────────
  console.log('━━━ GET /api/Agents (first record) ━━━');
  const agentsRaw = await qneGet('/api/Agents', token);
  const agents: any[] = Array.isArray(agentsRaw)
    ? agentsRaw
    : agentsRaw?.value || agentsRaw?.data || [];
  console.log(`Total agents: ${agents.length}`);
  if (agents[0]) {
    console.log('All fields on first agent:');
    console.log(JSON.stringify(agents[0], null, 2));
  }

  // ── 2. GET /api/Agents/{id} (detail) ──────────────────────
  if (agents[0]) {
    const agentId = agents[0].id || agents[0].Id || agents[0].code || agents[0].Code;
    if (agentId) {
      console.log(`\n━━━ GET /api/Agents/${agentId} (detail) ━━━`);
      try {
        const agentDetail = await qneGet(`/api/Agents/${agentId}`, token);
        console.log(JSON.stringify(agentDetail, null, 2));
      } catch (e: any) {
        console.log('Detail fetch failed:', e.message);
      }
    }
  }

  // ── 3. GET /api/Agents/Find ────────────────────────────────
  console.log('\n━━━ GET /api/Agents/Find (first result) ━━━');
  try {
    const agentFind = await qneGet('/api/Agents/Find', token);
    const findList: any[] = Array.isArray(agentFind)
      ? agentFind
      : agentFind?.value || agentFind?.data || [];
    console.log(`Total: ${findList.length}`);
    if (findList[0]) console.log(JSON.stringify(findList[0], null, 2));
  } catch (e: any) {
    console.log('Find failed:', e.message);
  }

  // ── 4. GET /api/Customers (list — first record) ────────────
  console.log('\n━━━ GET /api/Customers (first 3 records — ALL fields) ━━━');
  const customersRaw = await qneGet('/api/Customers', token);
  const customers: any[] = Array.isArray(customersRaw)
    ? customersRaw
    : customersRaw?.value || customersRaw?.data || [];
  console.log(`Total customers: ${customers.length}`);

  // Print first 3 to catch any variation
  for (let i = 0; i < Math.min(3, customers.length); i++) {
    console.log(`\nCustomer ${i + 1} — ALL fields:`);
    console.log(JSON.stringify(customers[i], null, 2));

    // Highlight anything that looks agent/sales related
    const agentRelated = Object.entries(customers[i]).filter(([k]) =>
      k.toLowerCase().includes('agent') ||
      k.toLowerCase().includes('sales') ||
      k.toLowerCase().includes('person') ||
      k.toLowerCase().includes('assign') ||
      k.toLowerCase().includes('staff') ||
      k.toLowerCase().includes('pic') ||
      k.toLowerCase().includes('handler')
    );
    if (agentRelated.length > 0) {
      console.log(`  → Agent-related fields found:`, Object.fromEntries(agentRelated));
    } else {
      console.log(`  → No agent-related fields found in list response`);
    }
  }

  // ── 5. GET /api/Customers/{id} (detail — first customer) ──
  const firstCustomer = customers[0];
  if (firstCustomer) {
    const custId = firstCustomer.id || firstCustomer.Id ||
                   firstCustomer.code || firstCustomer.Code ||
                   firstCustomer.customerCode || firstCustomer.CustomerCode ||
                   firstCustomer.debtorCode || firstCustomer.DebtorCode;
    if (custId) {
      console.log(`\n━━━ GET /api/Customers/${custId} (FULL DETAIL) ━━━`);
      try {
        const detail = await qneGet(`/api/Customers/${custId}`, token);
        console.log('All fields on detail record:');
        console.log(JSON.stringify(detail, null, 2));

        // Highlight agent-related
        const agentRelated = Object.entries(detail).filter(([k]) =>
          k.toLowerCase().includes('agent') ||
          k.toLowerCase().includes('sales') ||
          k.toLowerCase().includes('person') ||
          k.toLowerCase().includes('assign') ||
          k.toLowerCase().includes('staff') ||
          k.toLowerCase().includes('pic')
        );
        if (agentRelated.length > 0) {
          console.log('\n  → Agent-related fields in DETAIL:',
            Object.fromEntries(agentRelated));
        } else {
          console.log('\n  → No agent-related fields in detail either');
        }
      } catch (e: any) {
        console.log('Detail fetch failed:', e.message);
      }
    }
  }

  // ── 6. GET /api/Agents/{code}/OrderSummary ─────────────────
  if (agents[0]) {
    const agentCode = agents[0].code || agents[0].Code || agents[0].id || agents[0].Id;
    if (agentCode) {
      console.log(`\n━━━ GET /api/Agents/${agentCode}/OrderSummary ━━━`);
      try {
        const summary = await qneGet(
          `/api/Agents/${agentCode}/OrderSummary`, token);
        console.log(JSON.stringify(summary, null, 2));
      } catch (e: any) {
        console.log('OrderSummary failed:', e.message);
      }
    }
  }

  console.log('\n=== INSPECTION COMPLETE ===');
  console.log('Share the output above — it will show the exact field name');
  console.log('that links a customer to their salesperson in QNE.');
}

main()
  .catch(e => { console.error('\nFatal error:', e.message); process.exit(1); });
