import assert from 'assert';
import crypto from 'crypto';

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

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
  assert.strictEqual(snoopWithTokenARes.status, 404, 'Must return 404 to avoid leaking order existence');
  const snoopWithTokenAData = await snoopWithTokenARes.json();
  assert.ok(snoopWithTokenAData.error.includes('not found'));
  console.log('   🔒 BLOCKED (404): Customer A cannot view Customer B’s order!');

  console.log('\n4. Attack Test: Attacker queries Customer B’s order by ID with NO token...');
  const snoopNoTokenRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`);
  assert.strictEqual(snoopNoTokenRes.status, 404, 'Must return 404');
  console.log('   🔒 BLOCKED (404): Snooper without token cannot access order!');

  console.log('\n5. Attack Test: Attacker probes sequential order number (#' + orderB.orderNumber + ') with NO token...');
  const snoopSequentialRes = await fetch(`${BASE_URL}/api/orders/${orderB.orderNumber}`);
  assert.strictEqual(snoopSequentialRes.status, 404, 'Must return 404');
  console.log('   🔒 BLOCKED (404): Sequential order guessing attack prevented!');

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

  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: ADMIN_PIN })
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.token, 'Login must issue a session token');
  assert.notStrictEqual(loginData.token, ADMIN_PIN, 'Session token must not be the raw PIN');
  assert.ok(loginData.token.startsWith('adm_'), 'Session token must be opaque');
  console.log('   ✓ Admin login issues opaque session token (PIN not echoed)');

  const session = loginData.token;

  console.log('\n10. Leak Test: /api/settings must never return the stored PIN...');
  for (const headers of [{}, { 'x-admin-pin': session }]) {
    const res = await fetch(`${BASE_URL}/api/settings`, { headers });
    const body = await res.json();
    assert.strictEqual(body.adminPin, undefined, 'Settings must not expose the admin PIN hash');
    assert.strictEqual(body.razorpayKeySecret, undefined, 'Settings must not expose Razorpay secret');
  }
  console.log('   ✓ PIN hash hidden from both public and admin settings responses');

  console.log('\n11. Account isolation: User A must not read User B orders...');
  const suffix = Date.now();
  const signupA = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `sec_a_${suffix}`,
      password: 'secretpass',
      email: `seca${suffix}@spoonup.test`,
      phone: '+919800000001'
    })
  });
  assert.strictEqual(signupA.status, 201);
  const userA = await signupA.json();

  const signupB = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `sec_b_${suffix}`,
      password: 'secretpass',
      email: `secb${suffix}@spoonup.test`,
      phone: '+919800000002'
    })
  });
  assert.strictEqual(signupB.status, 201);
  const userB = await signupB.json();

  const orderForB = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-token': userB.token },
    body: JSON.stringify({
      customerName: 'User B',
      customerPhone: '+919800000002',
      items: [{ id: testProdId, quantity: 1 }]
    })
  });
  assert.strictEqual(orderForB.status, 201);
  const ownedByB = await orderForB.json();

  const snoopAsA = await fetch(`${BASE_URL}/api/orders/${ownedByB.id}`, {
    headers: { 'x-user-token': userA.token }
  });
  assert.strictEqual(snoopAsA.status, 404, 'Other users must not read profile-linked orders');

  const meOrdersA = await fetch(`${BASE_URL}/api/me/orders`, {
    headers: { 'x-user-token': userA.token }
  });
  assert.strictEqual(meOrdersA.status, 200);
  const listA = await meOrdersA.json();
  assert.ok(!listA.some(o => o.id === ownedByB.id));

  const meNoAuth = await fetch(`${BASE_URL}/api/me/orders`);
  assert.strictEqual(meNoAuth.status, 401);
  console.log('   🔒 BLOCKED: Cross-account order access and unauthenticated /api/me/orders');

  console.log('\n12. Weak signup and forged online payment must be rejected...');
  const weakSignup = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'ab',
      password: 'short',
      email: 'not-an-email',
      phone: '12'
    })
  });
  assert.strictEqual(weakSignup.status, 400);

  const badLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB.user.username, password: 'wrong-password' })
  });
  assert.strictEqual(badLogin.status, 401);

  const fakePay = await fetch(`${BASE_URL}/api/checkout/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checkoutId: 'chk-does-not-exist',
      razorpayPaymentId: 'pay_fake',
      razorpayOrderId: 'order_fake',
      razorpaySignature: 'deadbeef'
    })
  });
  assert.strictEqual(fakePay.status, 404);

  const kitchenShip = await fetch(`${BASE_URL}/api/orders/${orderB.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN },
    body: JSON.stringify({ status: 'shipped' })
  });
  assert.strictEqual(kitchenShip.status, 400, 'Kitchen orders cannot use delivery statuses');
  console.log('   🔒 Weak signup, bad login, fake payment, and illegal status blocked');

  console.log('\n12b. Razorpay webhooks must reject bad HMAC and still fulfill captured payments...');
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-webhook-secret';
  const signWebhook = (payload) => crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(payload))
    .digest('hex');

  const badWebhook = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    },
    body: JSON.stringify({ event: 'payment.captured', payload: {} })
  });
  assert.strictEqual(badWebhook.status, 400, 'Unsigned webhooks must be rejected');

  const prepareOnline = await fetch(`${BASE_URL}/api/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Webhook Guest',
      customerPhone: '+919700044455',
      items: [{ id: testProdId, quantity: 1 }],
      paymentMethod: 'online'
    })
  });
  assert.strictEqual(prepareOnline.status, 200);
  const onlineCheckout = await prepareOnline.json();
  const payId = 'pay_webhook_captured_1';
  const capturedPayload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: payId,
          order_id: onlineCheckout.razorpayOrderId,
          amount: Math.round(Number(onlineCheckout.amount) * 100),
          status: 'captured',
          captured: true,
          notes: { checkoutId: onlineCheckout.checkoutId }
        }
      }
    }
  };
  const capturedRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signWebhook(capturedPayload)
    },
    body: JSON.stringify(capturedPayload)
  });
  assert.strictEqual(capturedRes.status, 200);
  const capturedBody = await capturedRes.json();
  assert.strictEqual(capturedBody.status, 'completed');
  assert.ok(capturedBody.orderCount >= 1);

  const replayRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signWebhook(capturedPayload)
    },
    body: JSON.stringify(capturedPayload)
  });
  assert.strictEqual(replayRes.status, 200);
  const replayBody = await replayRes.json();
  assert.ok(replayBody.alreadyCompleted || replayBody.orderCount === capturedBody.orderCount);

  const refundPayload = {
    event: 'refund.processed',
    payload: {
      refund: { entity: { id: 'rfnd_webhook_1', payment_id: payId, amount: capturedPayload.payload.payment.entity.amount, status: 'processed' } }
    }
  };
  const refundRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signWebhook(refundPayload)
    },
    body: JSON.stringify(refundPayload)
  });
  assert.strictEqual(refundRes.status, 200);
  const refundedOrders = await fetch(`${BASE_URL}/api/orders`, {
    headers: { 'x-admin-pin': session }
  });
  const refundedList = await refundedOrders.json();
  const refunded = refundedList.find(o => o.razorpayPaymentId === payId);
  assert.ok(refunded);
  assert.strictEqual(refunded.paymentStatus, 'refunded');
  assert.strictEqual(refunded.status, 'refunded');

  const failPrepare = await fetch(`${BASE_URL}/api/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Failed Pay Guest',
      customerPhone: '+919700044466',
      items: [{ id: testProdId, quantity: 1 }],
      paymentMethod: 'online'
    })
  });
  const failCheckout = await failPrepare.json();
  const failPayload = {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_webhook_failed_1',
          order_id: failCheckout.razorpayOrderId,
          status: 'failed',
          notes: { checkoutId: failCheckout.checkoutId }
        }
      }
    }
  };
  const failWh = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': signWebhook(failPayload)
    },
    body: JSON.stringify(failPayload)
  });
  assert.strictEqual(failWh.status, 200);
  const completeFailed = await fetch(`${BASE_URL}/api/checkout/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkoutId: failCheckout.checkoutId })
  });
  assert.strictEqual(completeFailed.status, 400);
  console.log('   🔒 Webhook HMAC required; captured/refund/failed edge cases handled');

  console.log('\n13. Backdoor Test: the old PIN must stop working after a PIN change...');
  const rotatedPin = 'rotated-pin-9182';
  const rotateRes = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': session },
    body: JSON.stringify({ adminPin: rotatedPin })
  });
  assert.strictEqual(rotateRes.status, 200);

  const oldPinRes = await fetch(`${BASE_URL}/api/orders`, {
    headers: { 'x-admin-pin': ADMIN_PIN }
  });
  assert.strictEqual(oldPinRes.status, 401, 'Superseded PIN must not remain valid');

  const newPinRes = await fetch(`${BASE_URL}/api/orders`, {
    headers: { 'x-admin-pin': rotatedPin }
  });
  assert.strictEqual(newPinRes.status, 200, 'Rotated PIN must work');
  console.log('   🔒 Superseded PIN rejected (401); rotated PIN accepted (200)');

  // Restore the original PIN so repeat runs stay deterministic.
  const restoreRes = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': rotatedPin },
    body: JSON.stringify({ adminPin: ADMIN_PIN })
  });
  assert.strictEqual(restoreRes.status, 200);
  console.log('   ✓ Original PIN restored');

  console.log('\n🎉 ALL PRODUCTION SECURITY & ZERO-TRUST TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runSecurityTests().catch(err => {
  console.error('❌ Security Test Failure:', err);
  process.exit(1);
});
