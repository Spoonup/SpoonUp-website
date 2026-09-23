import assert from 'assert';
import crypto from 'crypto';

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

async function adminLogin(password = ADMIN_PASSWORD, username = ADMIN_USERNAME) {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res;
}

async function runSecurityTests() {
  console.log('🛡️  RUNNING RIGOROUS PRODUCTION SECURITY & ZERO-TRUST TESTS...\n');
  const bootstrapLogin = await adminLogin();
  assert.strictEqual(bootstrapLogin.status, 200);
  const ADMIN_TOKEN = (await bootstrapLogin.json()).token;

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
  console.log('\n7. Tamper Test: Customer tries to mutate Order Status without admin auth...');
  const tamperStatusRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' })
  });
  assert.strictEqual(tamperStatusRes.status, 401, 'Must reject unauthorized status mutation');
  console.log('   🔒 BLOCKED (401 Unauthorized): Non-admin cannot alter order status!');

  console.log('\n8. Legitimate Admin: Admin views Order B and advances status...');
  console.log('\n7b. Oracle Test: raw credentials must NOT be accepted on protected routes...');
  const rawCredRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`, {
    headers: { 'x-admin-token': ADMIN_PASSWORD }
  });
  assert.strictEqual(rawCredRes.status, 404, 'Raw password in a header must not grant admin access (would bypass the login rate limit)');
  const rawCredList = await fetch(`${BASE_URL}/api/orders`, { headers: { 'x-admin-token': ADMIN_PASSWORD } });
  assert.strictEqual(rawCredList.status, 401, 'Raw password must not authenticate admin list');
  const legacyHeader = await fetch(`${BASE_URL}/api/orders`, { headers: { 'x-admin-pin': ADMIN_TOKEN } });
  assert.strictEqual(legacyHeader.status, 200, 'Legacy x-admin-pin header must still carry a valid session token');
  console.log('   🔒 Raw credentials rejected; only /api/admin/login accepts them (legacy header still carries tokens)');

  const adminGetRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}`, {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  assert.strictEqual(adminGetRes.status, 200);
  const adminOrderB = await adminGetRes.json();
  assert.strictEqual(adminOrderB.customerPhone, '+919876500002', 'Admin must see unmasked phone for WhatsApp');

  const adminStatusRes = await fetch(`${BASE_URL}/api/orders/${orderB.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
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
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.token, 'Login must issue a session token');
  assert.notStrictEqual(loginData.token, ADMIN_PASSWORD, 'Session token must not be the raw password');
  assert.ok(loginData.token.startsWith('adm_'), 'Session token must be opaque');
  console.log('   ✓ Admin login issues opaque session token (password not echoed)');

  const session = loginData.token;

  console.log('\n10. Leak Test: /api/settings must never return the stored admin password...');
  for (const headers of [{}, { 'x-admin-token': session }]) {
    const res = await fetch(`${BASE_URL}/api/settings`, { headers });
    const body = await res.json();
    assert.strictEqual(body.adminPassword, undefined, 'Settings must not expose the admin password hash');
    assert.strictEqual(body.adminPin, undefined, 'Settings must not expose any legacy PIN field');
    assert.strictEqual(body.razorpayKeySecret, undefined, 'Settings must not expose Razorpay secret');
  }
  // The username is half the credential: anonymous callers must not learn it.
  const anonSettings = await (await fetch(`${BASE_URL}/api/settings`)).json();
  assert.strictEqual(anonSettings.adminUsername, undefined, 'Public settings must not expose the admin username');
  const adminSettings = await (await fetch(`${BASE_URL}/api/settings`, {
    headers: { 'x-admin-token': session }
  })).json();
  assert.strictEqual(adminSettings.adminUsername, ADMIN_USERNAME, 'An authenticated admin may read the username');
  console.log('   ✓ Password hash hidden everywhere; username only visible to an authenticated admin');

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
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
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
    headers: { 'x-admin-token': session }
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

  console.log('\n13. Backdoor Test: old credentials and old sessions must stop working after a change...');
  const weakRotate = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': session },
    body: JSON.stringify({ adminPassword: 'short1', currentPassword: ADMIN_PASSWORD })
  });
  assert.strictEqual(weakRotate.status, 400, 'Passwords shorter than 8 characters must be rejected');

  const badUsername = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': session },
    body: JSON.stringify({ adminUsername: 'a b!', currentPassword: ADMIN_PASSWORD })
  });
  assert.strictEqual(badUsername.status, 400, 'Malformed admin usernames must be rejected');

  const noCurrentPassword = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': session },
    body: JSON.stringify({ adminPassword: 'brand-new-password' })
  });
  assert.strictEqual(noCurrentPassword.status, 403, 'Changing the login without the current password must be refused');
  const noCurrentBody = await noCurrentPassword.json();
  assert.strictEqual(noCurrentBody.code, 'CURRENT_PASSWORD_REQUIRED');

  const wrongCurrentPassword = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': session },
    body: JSON.stringify({ adminPassword: 'brand-new-password', currentPassword: 'not-the-password' })
  });
  assert.strictEqual(wrongCurrentPassword.status, 403, 'A wrong current password must not allow a credential change');
  console.log('   🔒 Weak password, bad username, and missing/wrong current password all refused');

  const rotatedPassword = 'rotated-password-9182';
  const rotateRes = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': session },
    body: JSON.stringify({ adminPassword: rotatedPassword, currentPassword: ADMIN_PASSWORD })
  });
  assert.strictEqual(rotateRes.status, 200);
  assert.strictEqual((await rotateRes.json()).credentialChanged, true);

  const oldPasswordLogin = await adminLogin(ADMIN_PASSWORD);
  assert.strictEqual(oldPasswordLogin.status, 401, 'Superseded password must not log in');

  const oldSessionRes = await fetch(`${BASE_URL}/api/orders`, {
    headers: { 'x-admin-token': session }
  });
  assert.strictEqual(oldSessionRes.status, 401, 'Sessions issued under the old password must be revoked');

  const newLogin = await adminLogin(rotatedPassword);
  assert.strictEqual(newLogin.status, 200, 'Rotated password must log in');
  const rotatedSession = (await newLogin.json()).token;
  const newSessionRes = await fetch(`${BASE_URL}/api/orders`, {
    headers: { 'x-admin-token': rotatedSession }
  });
  assert.strictEqual(newSessionRes.status, 200, 'Session from the rotated password must work');
  console.log('   🔒 Old password and old sessions rejected (401); rotated password issues a working session');

  console.log('\n13b. Wrong username must not authenticate even with the right password...');
  const wrongUser = await adminLogin(rotatedPassword, 'not-the-admin');
  assert.strictEqual(wrongUser.status, 401, 'Correct password with the wrong username must be rejected');
  const emptyUser = await adminLogin(rotatedPassword, '');
  assert.strictEqual(emptyUser.status, 400, 'Empty username must be rejected');
  console.log('   🔒 Username is actually checked, not decorative');

  console.log('\n13c. Changing the username must also revoke sessions...');
  const renameRes = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': rotatedSession },
    body: JSON.stringify({ adminUsername: 'renamed_admin', currentPassword: rotatedPassword })
  });
  assert.strictEqual(renameRes.status, 200);
  const afterRename = await fetch(`${BASE_URL}/api/orders`, { headers: { 'x-admin-token': rotatedSession } });
  assert.strictEqual(afterRename.status, 401, 'Renaming the admin must revoke existing sessions');
  const renamedLogin = await adminLogin(rotatedPassword, 'renamed_admin');
  assert.strictEqual(renamedLogin.status, 200, 'New username must log in');
  const renamedSession = (await renamedLogin.json()).token;
  console.log('   🔒 Username change revokes sessions; new username logs in');

  console.log('\n14. Logout must revoke the admin session...');
  const logoutRes = await fetch(`${BASE_URL}/api/admin/logout`, {
    method: 'POST',
    headers: { 'x-admin-token': renamedSession }
  });
  assert.strictEqual(logoutRes.status, 200);
  const afterLogout = await fetch(`${BASE_URL}/api/orders`, { headers: { 'x-admin-token': renamedSession } });
  assert.strictEqual(afterLogout.status, 401, 'A logged-out session must be rejected');
  console.log('   🔒 Logged-out session rejected');

  // Restore the original credentials so repeat runs stay deterministic.
  const restoreSession = (await (await adminLogin(rotatedPassword, 'renamed_admin')).json()).token;
  const restoreRes = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': restoreSession },
    body: JSON.stringify({
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      currentPassword: rotatedPassword
    })
  });
  assert.strictEqual(restoreRes.status, 200);
  console.log('   ✓ Original admin credentials restored');

  console.log('\n15. Wildcard login: LIKE metacharacters must never match another account...');
  const wildcardLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '%', password: 'secretpass' })
  });
  assert.strictEqual(wildcardLogin.status, 401, 'Wildcard username must not authenticate');
  const underscoreName = userB.user.username.replace(/[a-z]/, '_');
  const underscoreLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: underscoreName, password: 'secretpass' })
  });
  assert.strictEqual(underscoreLogin.status, 401, 'Underscore wildcard must not match a different username');
  console.log('   🔒 Wildcard usernames rejected');

  console.log('\n16. Race Test: concurrent webhook + client complete must create exactly one order set...');
  const racePrepare = await fetch(`${BASE_URL}/api/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Race Guest',
      customerPhone: '+919700044477',
      items: [{ id: testProdId, quantity: 1 }],
      paymentMethod: 'online'
    })
  });
  assert.strictEqual(racePrepare.status, 200);
  const raceCheckout = await racePrepare.json();
  const racePayId = 'pay_webhook_race_1';
  const racePayload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: racePayId,
          order_id: raceCheckout.razorpayOrderId,
          amount: Math.round(Number(raceCheckout.amount) * 100),
          status: 'captured',
          captured: true,
          notes: { checkoutId: raceCheckout.checkoutId }
        }
      }
    }
  };
  const fire = () => fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signWebhook(racePayload) },
    body: JSON.stringify(racePayload)
  });
  const raceResults = await Promise.all([fire(), fire(), fire()]);
  for (const r of raceResults) assert.ok([200, 503].includes(r.status), `Webhook race responses must be 200 or 503, got ${r.status}`);
  const finalSession = (await (await adminLogin()).json()).token;
  const allOrders = await (await fetch(`${BASE_URL}/api/orders?limit=1000`, { headers: { 'x-admin-token': finalSession } })).json();
  const raceOrders = allOrders.filter(o => o.razorpayPaymentId === racePayId);
  assert.strictEqual(raceOrders.length, 1, `Exactly one order must exist for the payment, found ${raceOrders.length}`);
  console.log('   🔒 Concurrent fulfilment produced exactly one order');

  console.log('\n17. Brute-force Test: repeated failed admin logins must be rate limited...');
  let sawLimit = false;
  for (let i = 0; i < 8; i++) {
    const attempt = await adminLogin(`wrong-password-${i}`);
    if (attempt.status === 429) { sawLimit = true; break; }
    assert.strictEqual(attempt.status, 401);
  }
  assert.ok(sawLimit, 'Admin login must return 429 after repeated failures');
  console.log('   🔒 Admin login rate limit engaged (429)');

  console.log('\n🎉 ALL PRODUCTION SECURITY & ZERO-TRUST TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runSecurityTests().catch(err => {
  console.error('❌ Security Test Failure:', err);
  process.exit(1);
});
