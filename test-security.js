import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:5001';
const ADMIN_PIN = '1234';

async function runSecurityTests() {
  console.log('🛡️  RUNNING RIGOROUS PRODUCTION SECURITY & ZERO-TRUST TESTS...\n');

  // 1. Get products for test orders
  const prodRes = await fetch(`${BASE_URL}/api/products`);
  assert.strictEqual(prodRes.status, 200);
  const products = await prodRes.json();
  const testProdId = products[0].id;

  // ------------------------------------------------------------------------
  // TEST SCENARIO: TWO CUSTOMERS PLACE NEIGHBORING ORDERS
  // ------------------------------------------------------------------------
  console.log('1. Customer A places Order #1...');
  const orderARes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Alice Smith',
      customerPhone: '+919876500001',
      items: [{ id: testProdId, quantity: 1 }],
      notes: 'Alice private order note'
    })
  });
  assert.strictEqual(orderARes.status, 201);
  const orderA = await orderARes.json();
  assert.ok(orderA.accessToken, 'Order A must have an unguessable accessToken');
  assert.ok(orderA.accessToken.startsWith('order_sec_'), 'Token must have order_sec_ prefix');
  console.log(`   ✓ Customer A Order placed: #${orderA.orderNumber} (Token: ${orderA.accessToken.slice(0, 16)}...)`);

  console.log('\n2. Customer B places neighboring Order #2...');
  const orderBRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Bob Jones',
      customerPhone: '+919876500002',
      items: [{ id: testProdId, quantity: 2 }],
      notes: 'Bob confidential allergic note'
    })
  });
  assert.strictEqual(orderBRes.status, 201);
  const orderB = await orderBRes.json();
  assert.ok(orderB.accessToken, 'Order B must have an unguessable accessToken');
  assert.notStrictEqual(orderA.accessToken, orderB.accessToken, 'Tokens must be distinct');
  console.log(`   ✓ Customer B Order placed: #${orderB.orderNumber} (Token: ${orderB.accessToken.slice(0, 16)}...)`);

  // ------------------------------------------------------------------------
  // ZERO-TRUST IDOR / NEIGHBORING ATTACK TESTS
  // ------------------------------------------------------------------------
  console.log('\n3. Attack Test: Customer A tries to snoop on Customer B’s Order using Token A...');
  const snoopWithTokenARes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`, {
    headers: { 'x-order-token': orderA.accessToken }
  });
  assert.strictEqual(snoopWithTokenARes.status, 403, 'Must return 403 Forbidden');
  const snoopWithTokenAData = await snoopWithTokenARes.json();
  assert.ok(snoopWithTokenAData.error.includes('Access Denied'));
  console.log('   🔒 BLOCKED (403 Forbidden): Customer A cannot view Customer B’s order!');

  console.log('\n4. Attack Test: Attacker queries Customer B’s order by ID with NO token...');
  const snoopNoTokenRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`);
  assert.strictEqual(snoopNoTokenRes.status, 403, 'Must return 403 Forbidden');
  console.log('   🔒 BLOCKED (403 Forbidden): Snooper without token cannot access order!');

  console.log('\n5. Attack Test: Attacker probes sequential order number (#' + orderB.orderNumber + ') with NO token...');
  const snoopSequentialRes = await fetch(`${BASE_URL}/api/orders/${orderB.orderNumber}`);
  assert.strictEqual(snoopSequentialRes.status, 403, 'Must return 403 Forbidden');
  console.log('   🔒 BLOCKED (403 Forbidden): Sequential order guessing attack prevented!');

  console.log('\n6. Legitimate Access: Customer B views their own Order with Token B...');
  const validAccessRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`, {
    headers: { 'x-order-token': orderB.accessToken }
  });
  assert.strictEqual(validAccessRes.status, 200, 'Must return 200 OK');
  const validOrderB = await validAccessRes.json();
  assert.strictEqual(validOrderB.orderNumber, orderB.orderNumber);
  assert.strictEqual(validOrderB.customerName, 'Bob Jones');
  assert.ok(validOrderB.customerPhone.includes('••••••'), 'Phone number should be masked for public view');
  console.log('   ✓ GRANTED (200 OK): Customer B successfully viewed order (Phone safely masked: ' + validOrderB.customerPhone + ')');

  // ------------------------------------------------------------------------
  // STATUS TAMPERING ATTACK TESTS
  // ------------------------------------------------------------------------
  console.log('\n7. Tamper Test: Customer tries to mutate Order Status without Admin PIN...');
  const tamperStatusRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' })
  });
  assert.strictEqual(tamperStatusRes.status, 401, 'Must reject unauthorized status mutation');
  console.log('   🔒 BLOCKED (401 Unauthorized): Non-admin cannot alter order status!');

  console.log('\n8. Legitimate Admin: Admin views Order B and advances status...');
  const adminGetRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`, {
    headers: { 'x-admin-pin': ADMIN_PIN }
  });
  assert.strictEqual(adminGetRes.status, 200);
  const adminOrderB = await adminGetRes.json();
  assert.strictEqual(adminOrderB.customerPhone, '+919876500002', 'Admin must see unmasked phone for WhatsApp');

  const adminStatusRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ status: 'ready' })
  });
  assert.strictEqual(adminStatusRes.status, 200);
  const updatedOrderB = await adminStatusRes.json();
  assert.strictEqual(updatedOrderB.status, 'ready');
  console.log('   ✓ GRANTED (200 OK): Admin verified and advanced status to READY');

  // ------------------------------------------------------------------------
  // INPUT VALIDATION & SECURITY HEADERS
  // ------------------------------------------------------------------------
  console.log('\n9. Testing Security Headers & Input Bounds...');
  assert.strictEqual(adminGetRes.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(adminGetRes.headers.get('x-frame-options'), 'DENY');
  console.log('   ✓ Security headers verified (nosniff, DENY)');

  const invalidOrderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'A', // too short
      customerPhone: '123', // invalid phone
      items: []
    })
  });
  assert.strictEqual(invalidOrderRes.status, 400);
  console.log('   ✓ Invalid input rejected with 400 Bad Request');

  console.log('\n🎉 ALL PRODUCTION SECURITY & ZERO-TRUST TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runSecurityTests().catch(err => {
  console.error('❌ Security Test Failure:', err);
  process.exit(1);
});
