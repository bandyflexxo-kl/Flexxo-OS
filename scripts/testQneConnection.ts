import fetch from 'node-fetch';

const BASE_URL = 'http://26.255.19.220:82';
const DB_CODE = 'FKLSB';
const USERNAME = 'SALES 6';
const PASSWORD = '12345';

async function testConnection() {
  console.log('=== QNE CONNECTION TEST ===\n');

  // STEP 1 — Login
  console.log('STEP 1: Logging in...');
  let token = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/api/Users/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbCode: DB_CODE, userName: USERNAME, password: PASSWORD })
    });
    const loginData = await loginRes.json();
    console.log('LOGIN RESPONSE:', JSON.stringify(loginData, null, 2));
    token = loginData.token || loginData.Token || loginData.accessToken || '';
    console.log('Token received:', token ? 'YES' : 'NO');
  } catch (err) {
    console.log('LOGIN FAILED:', err);
    return;
  }

  if (!token) {
    console.log('No token found — cannot continue.');
    return;
  }

  // STEP 2 — Fetch customers
  console.log('\nSTEP 2: Fetching customers...');
  try {
    const custRes = await fetch(`${BASE_URL}/api/Customers`, {
      headers: {
        'DbCode': DB_CODE,
        'Authorization': `Bearer ${token}`
      }
    });
    const custData = await custRes.json();
    const customers = Array.isArray(custData) ? custData : custData.value || custData.data || [];
    console.log('Total customers returned:', customers.length);
    if (customers.length > 0) {
      console.log('First customer:', JSON.stringify(customers[0], null, 2));
    }
  } catch (err) {
    console.log('CUSTOMERS FETCH FAILED:', err);
  }

  console.log('\n=== TEST COMPLETE ===');
}

testConnection();