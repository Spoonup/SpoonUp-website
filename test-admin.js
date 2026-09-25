import assert from 'assert';
import crypto from 'crypto';

/**
 * Admin panel backend: authorization, customer history, orders on behalf,
 * and coupon administration.
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const call = (m, p, b, h = {}) =>
  fetch(`${BASE_URL}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json', ...h },
    body: b === undefined ? undefined : JSON.stringify(b)
  }).then(j);
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);
const patch = (p, b, h) => call('PATCH', p, b, h);

const uniq = (p) => `${p}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const near = (a, b, t = 0.02) => Math.abs(Number(a) - Number(b)) < t;

async function run() {
  console.log('🚀 Running admin panel backend tests...\n');

  const login = await post('/api/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert.strictEqual(login.status, 200);
  const A = { 'x-admin-token': login.body.token };

  const prod = await post('/api/products', {
    name: 'Admin Test Item', price: 500, gstRate: 5, fulfillmentKind: 'IMMEDIATE'
  }, A);
  assert.strictEqual(prod.status, 201);
  const productId = prod.body.id;

  // ---- 1. authorization: every admin route rejects non-admins ----
  console.log('1. Testing server-side authorization on every admin route...');
  const customer = await post('/api/auth/signup', {
    username: uniq('cust').toLowerCase(), password: 'customer-pass-123',
    email: `${uniq('cust').toLowerCase()}@example.com`, phone: '9944000011'
  });
  assert.strictEqual(customer.status, 201);
  const U = { 'x-user-token': customer.token || customer.body.token };

  const ADMIN_ROUTES = [
    ['GET', '/api/orders'], ['GET', '/api/stats'], ['GET', '/api/orders/export/csv'],
    ['GET', '/api/coupons'], ['GET', '/api/platform-price-rules'], ['GET', '/api/referral-rules/active'],
    ['GET', '/api/admin/customers/history?phone=9944000011'],
    ['POST', '/api/admin/orders'], ['POST', '/api/coupons'], ['POST', '/api/products'],
    ['POST', '/api/platform-price-rules'], ['POST', '/api/referral-rules'],
    ['POST', '/api/referrals/qualify'], ['POST', '/api/subscriptions/run-due'],
    ['POST', '/api/wallets/w1/adjust'], ['GET', '/api/wallets/w1/statement'],
    ['GET', '/api/subscriptions/s1'], ['PATCH', '/api/subscriptions/s1/status'],
    ['PATCH', '/api/orders/o1/status'], ['PUT', '/api/settings'],
    ['DELETE', '/api/products/p1'], ['GET', '/api/parent-orders/x1']
  ];

  // Anonymous probes cost nothing: authenticateAdmin rejects a missing
  // credential before it records a failure, so every route can be checked.
  for (const [method, path] of ADMIN_ROUTES) {
    const anon = await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {});
    assert.strictEqual(anon.status, 401, `${method} ${path} must reject anonymous (got ${anon.status})`);
  }

  // Credential rejection is a property of the shared middleware, and each bad
  // credential counts against the invalid-token limiter (20/15min) — which is a
  // control worth keeping, so a sample is probed rather than all 22 routes.
  const SAMPLE = [['GET', '/api/orders'], ['POST', '/api/admin/orders'], ['PUT', '/api/settings']];
  for (const [method, path] of SAMPLE) {
    const asUser = await call(method, path, method === 'GET' ? undefined : {}, U);
    assert.strictEqual(asUser.status, 401, `${method} ${path} must reject a customer token (got ${asUser.status})`);

    const forged = await call(method, path, method === 'GET' ? undefined : {},
      { 'x-admin-token': `adm_${'f'.repeat(40)}.${'0'.repeat(64)}` });
    assert.ok([401, 429].includes(forged.status),
      `${method} ${path} must reject a forged token (got ${forged.status})`);
  }
  console.log(`   🔒 ${ADMIN_ROUTES.length} routes reject anonymous; customer and forged tokens rejected on ${SAMPLE.length} sampled routes`);

  // ---- 2. raw credentials must not work as a token ----
  console.log('2. Testing raw credentials are not accepted outside /admin/login...');
  const rawCred = await get('/api/orders', { 'x-admin-token': ADMIN_PASSWORD });
  assert.ok([401, 429].includes(rawCred.status), 'the password must never act as a session token');
  console.log('   🔒 Raw password rejected on protected routes');

  // ---- 3. order history ----
  console.log('3. Testing complete customer order history...');
  const phone = '+919955000001';
  const o1 = await post('/api/parent-orders', {
    customerName: 'History Customer', customerPhone: phone,
    lines: [{ id: productId, quantity: 2 }]
  });
  assert.strictEqual(o1.status, 201);
  const o2 = await post('/api/parent-orders', {
    customerName: 'History Customer', customerPhone: phone,
    lines: [{ id: productId, quantity: 1 }]
  });
  assert.strictEqual(o2.status, 201);

  // Close one order so history is proven not to be "active only".
  const firstSub = o1.body.subOrders[0].id;
  for (const st of ['preparing', 'ready', 'out_for_delivery', 'delivered']) {
    const r = await patch(`/api/orders/${firstSub}/status`, { status: st }, A);
    assert.strictEqual(r.status, 200, `${st}: ${JSON.stringify(r.body)}`);
  }

  const hist = await get(`/api/admin/customers/history?phone=${encodeURIComponent(phone)}`, A);
  assert.strictEqual(hist.status, 200, JSON.stringify(hist.body));
  assert.strictEqual(hist.body.totals.orderCount, 2, 'both orders returned');

  const delivered = hist.body.orders.flatMap((o) => o.subOrders).filter((s) => s.status === 'delivered');
  assert.strictEqual(delivered.length, 1, 'a completed order is still in history');

  const sample = hist.body.orders.find((o) => o.parentOrderId === o1.body.parentOrder.id);
  assert.ok(sample, 'history is keyed by parent order');
  assert.ok(sample.subOrders.length >= 1);
  assert.ok(sample.subOrders[0].items.length >= 1, 'items are included');
  assert.equal(sample.subOrders[0].items[0].productId, productId);
  assert.ok(near(sample.money.originalTotal, 1050), `2 × 500 + GST, got ${sample.money.originalTotal}`);
  assert.ok(sample.money.finalAmount !== undefined);
  assert.ok(sample.payment.status, 'payment status present');
  console.log(`   ✓ ${hist.body.totals.orderCount} orders incl. a delivered one; items, money and payment all present`);

  // ---- 4. history for a registered customer: plans + wallet ----
  console.log('4. Testing history includes subscription payments and wallet ledger...');
  const planProd = await post('/api/products', {
    name: 'Admin Plan Item', price: 300, gstRate: 5, fulfillmentKind: 'IMMEDIATE', subscribable: true
  }, A);
  const regUser = await post('/api/auth/signup', {
    username: uniq('plan').toLowerCase(), password: 'planner-pass-123',
    email: `${uniq('plan').toLowerCase()}@example.com`, phone: '9955000002'
  });
  const RU = { 'x-user-token': regUser.body.token };
  const planOrder = await post('/api/parent-orders', {
    customerName: 'Plan Customer', customerPhone: '+919955000002',
    lines: [{ id: planProd.body.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }]
  }, RU);
  assert.strictEqual(planOrder.status, 201, JSON.stringify(planOrder.body));
  const planId = planOrder.body.subscriptions[0].id;
  await post(`/api/subscriptions/${planId}/mark-paid`, {}, A);

  const regHist = await get(`/api/admin/customers/history?userId=${regUser.body.user.id}`, A);
  assert.strictEqual(regHist.status, 200);
  assert.strictEqual(regHist.body.customer.registered, true);
  assert.strictEqual(regHist.body.subscriptions.length, 1, 'plans included');
  assert.ok(regHist.body.subscriptions[0].deliveries.length > 0, 'delivery schedule included');
  assert.strictEqual(regHist.body.wallets.length, 1, 'wallet included');
  assert.ok(regHist.body.wallets[0].transactions.length >= 1, 'wallet ledger included');
  assert.ok(regHist.body.wallets[0].balance > 0, 'the upfront plan payment shows as a credit');
  assert.strictEqual(regHist.body.wallets[0].isWithdrawable, false);
  console.log(`   ✓ Plan, ${regHist.body.subscriptions[0].deliveries.length} deliveries and wallet ledger (₹${regHist.body.wallets[0].balance}) all returned`);

  // ---- 5. negotiated order ----
  console.log('5. Testing an admin order with a negotiated price...');
  const negotiated = await post('/api/admin/orders', {
    customerName: 'Negotiated Buyer', customerPhone: '+919955000003',
    lines: [{ id: productId, quantity: 4 }],       // 4 × 500 = 2000 + GST = 2100
    negotiatedTotal: 1800,
    negotiationReason: 'Bulk event order'
  }, A);
  assert.strictEqual(negotiated.status, 201, JSON.stringify(negotiated.body));
  const np = negotiated.body.parentOrder;
  assert.ok(near(np.calculatedTotal, 2100), `original total preserved, got ${np.calculatedTotal}`);
  assert.ok(near(np.negotiatedTotal, 1800), 'negotiated price preserved');
  assert.ok(near(np.negotiatedDiscount, 300), `discount derived: 2100 − 1800, got ${np.negotiatedDiscount}`);
  assert.ok(near(np.payableTotal, 1800), 'payable is the negotiated price');
  assert.ok(np.createdByAdmin, 'the acting admin is recorded');
  assert.strictEqual(np.source, 'ADMIN');
  assert.ok(String(np.notes).includes('Bulk event order'), 'the reason is kept as audit information');
  console.log(`   ✓ ₹${np.calculatedTotal} → ₹${np.negotiatedTotal}, discount ₹${np.negotiatedDiscount} derived, admin ${np.createdByAdmin} recorded`);

  // ---- 6. invalid negotiated prices ----
  console.log('6. Testing invalid negotiated prices are refused...');
  const above = await post('/api/admin/orders', {
    customerName: 'Bad Buyer', customerPhone: '+919955000004',
    lines: [{ id: productId, quantity: 1 }], negotiatedTotal: 99999
  }, A);
  assert.strictEqual(above.status, 400);
  assert.strictEqual(above.body.code, 'NEGOTIATED_ABOVE_TOTAL');

  const negativePrice = await post('/api/admin/orders', {
    customerName: 'Bad Buyer', customerPhone: '+919955000004',
    lines: [{ id: productId, quantity: 1 }], negotiatedTotal: -50
  }, A);
  assert.strictEqual(negativePrice.body.code, 'INVALID_NEGOTIATED_PRICE');

  const nonNumeric = await post('/api/admin/orders', {
    customerName: 'Bad Buyer', customerPhone: '+919955000004',
    lines: [{ id: productId, quantity: 1 }], negotiatedTotal: 'free please'
  }, A);
  assert.strictEqual(nonNumeric.body.code, 'INVALID_NEGOTIATED_PRICE');

  const noName = await post('/api/admin/orders', {
    customerName: 'X', customerPhone: '+919955000004', lines: [{ id: productId, quantity: 1 }]
  }, A);
  assert.strictEqual(noName.status, 400, 'customer name is required');

  const badPhone = await post('/api/admin/orders', {
    customerName: 'Valid Name', customerPhone: '12', lines: [{ id: productId, quantity: 1 }]
  }, A);
  assert.strictEqual(badPhone.status, 400, 'a valid phone is required');

  const freebie = await post('/api/admin/orders', {
    customerName: 'Comp Order', customerPhone: '+919955000005',
    lines: [{ id: productId, quantity: 1 }], negotiatedTotal: 0, negotiationReason: 'Service recovery'
  }, A);
  assert.strictEqual(freebie.status, 201, 'a fully comped order is allowed');
  assert.ok(near(freebie.body.parentOrder.payableTotal, 0));
  console.log('   🔒 Above-total, negative, non-numeric, missing name and bad phone all refused; ₹0 comp allowed');

  // ---- 7. coupon administration ----
  console.log('7. Testing coupon creation across all three scopes...');
  const globalCode = uniq('ADMG');
  const g = await post('/api/coupons', {
    code: globalCode, scope: 'GLOBAL', discountType: 'PERCENT', discountValue: 10, maxDiscountAmount: 200
  }, A);
  assert.strictEqual(g.status, 201);
  assert.ok(g.body.createdByAdmin, 'the creating admin is recorded');

  const cohortCode = uniq('ADMC');
  const c = await post('/api/coupons', {
    code: cohortCode, scope: 'COHORT', discountType: 'FLAT', discountValue: 100,
    cohortUserIds: [regUser.body.user.id]
  }, A);
  assert.strictEqual(c.status, 201);

  const singleCode = uniq('ADMS');
  const sgl = await post('/api/coupons', {
    code: singleCode, scope: 'SINGLE_USER', singleUserId: regUser.body.user.id,
    discountType: 'FLAT', discountValue: 250
  }, A);
  assert.strictEqual(sgl.status, 201);

  const listed = await get('/api/coupons', A);
  const codes = listed.body.map((x) => x.code);
  for (const code of [globalCode, cohortCode, singleCode]) assert.ok(codes.includes(code));
  console.log('   ✓ Global, cohort and single-user coupons created and listed');

  // ---- 8. coupon scope enforcement ----
  console.log('8. Testing coupon scope is enforced server-side...');
  const memberOk = await post('/api/coupons/validate',
    { code: cohortCode, subtotal: 1000 }, RU);
  assert.strictEqual(memberOk.body.valid, true, 'a cohort member can use it');

  const outsider = await post('/api/coupons/validate', { code: cohortCode, subtotal: 1000, phone: '9955009999' });
  assert.strictEqual(outsider.body.valid, false);
  assert.strictEqual(outsider.body.reason, 'COUPON_NOT_FOUND', 'must not reveal the coupon exists');

  const ownerOk = await post('/api/coupons/validate', { code: singleCode, subtotal: 1000 }, RU);
  assert.strictEqual(ownerOk.body.valid, true);
  const notOwner = await post('/api/coupons/validate', { code: singleCode, subtotal: 1000, phone: '9955008888' });
  assert.strictEqual(notOwner.body.valid, false);
  console.log('   🔒 Cohort and single-user scope enforced; outsiders get an indistinguishable error');

  // ---- 9. single-use per user ----
  console.log('9. Testing single-use-per-user on an admin order...');
  const useCode = uniq('ADMU');
  await post('/api/coupons', { code: useCode, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 100 }, A);
  const buyerPhone = '+919955000006';

  const firstUse = await post('/api/admin/orders', {
    customerName: 'Coupon Buyer', customerPhone: buyerPhone,
    lines: [{ id: productId, quantity: 1 }], couponCode: useCode
  }, A);
  assert.strictEqual(firstUse.status, 201);
  assert.ok(near(firstUse.body.parentOrder.couponDiscount, 100));
  assert.ok(near(firstUse.body.parentOrder.payableTotal, 425), `525 − 100, got ${firstUse.body.parentOrder.payableTotal}`);

  const secondUse = await post('/api/admin/orders', {
    customerName: 'Coupon Buyer', customerPhone: buyerPhone,
    lines: [{ id: productId, quantity: 1 }], couponCode: useCode
  }, A);
  assert.strictEqual(secondUse.status, 400);
  assert.strictEqual(secondUse.body.code, 'COUPON_ALREADY_USED');
  console.log('   🔒 Coupon applied once (₹525 → ₹425); a second admin order refused');

  // ---- 10. coupon + negotiation interact correctly ----
  console.log('10. Testing negotiation is judged AFTER the coupon...');
  const comboCode = uniq('ADMX');
  await post('/api/coupons', { code: comboCode, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 100 }, A);
  const combo = await post('/api/admin/orders', {
    customerName: 'Combo Buyer', customerPhone: '+919955000007',
    lines: [{ id: productId, quantity: 2 }],    // 1050
    couponCode: comboCode,                      // → 950
    negotiatedTotal: 900
  }, A);
  assert.strictEqual(combo.status, 201, JSON.stringify(combo.body));
  assert.ok(near(combo.body.parentOrder.payableTotal, 900));
  assert.ok(near(combo.body.negotiation.negotiatedDiscount, 50), 'negotiated against the post-coupon total');

  const overCoupon = await post('/api/admin/orders', {
    customerName: 'Combo Buyer', customerPhone: '+919955000008',
    lines: [{ id: productId, quantity: 2 }], couponCode: uniq('NONE'), negotiatedTotal: 1000
  }, A);
  assert.strictEqual(overCoupon.status, 400, 'an unknown coupon fails the order rather than being ignored');
  console.log('   ✓ Negotiation applies to the post-coupon total (1050 → 950 → 900)');

  // ---- 11. history reflects admin orders ----
  console.log('11. Testing admin-made orders appear in customer history...');
  const admHist = await get('/api/admin/customers/history?phone=919955000003', A);
  assert.strictEqual(admHist.status, 200);
  const admOrder = admHist.body.orders.find((o) => o.source === 'ADMIN');
  assert.ok(admOrder, 'the admin order is in the history');
  assert.ok(near(admOrder.money.originalTotal, 2100));
  assert.ok(near(admOrder.money.negotiatedTotal, 1800));
  assert.ok(near(admOrder.money.negotiatedDiscount, 300));
  assert.ok(admOrder.createdByAdmin, 'admin attribution survives into history');
  console.log('   ✓ Original total, negotiated price, discount and admin id all retrievable');

  // ---- 12. history requires a key and rejects nothing-queries ----
  console.log('12. Testing history input validation...');
  const noKey = await get('/api/admin/customers/history', A);
  assert.strictEqual(noKey.status, 400);
  assert.strictEqual(noKey.body.code, 'CUSTOMER_KEY_REQUIRED');
  const unknown = await get('/api/admin/customers/history?phone=900000000000', A);
  assert.strictEqual(unknown.status, 200);
  assert.strictEqual(unknown.body.totals.orderCount, 0, 'an unknown customer is empty, not an error');
  console.log('   ✓ A key is required; an unknown customer returns an empty history');

  console.log('\n🎉 ADMIN PANEL BACKEND TESTS PASSED! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ ADMIN TESTS FAILED:', err.message);
  process.exit(1);
});
