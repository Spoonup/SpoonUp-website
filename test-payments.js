import assert from 'assert';
import crypto from 'crypto';

/**
 * Payment hardening, platform pricing, coupons and referrals — against a live server.
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-webhook-secret';

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const call = (m, p, b, h = {}) =>
  fetch(`${BASE_URL}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json', ...h },
    body: b === undefined ? undefined : JSON.stringify(b)
  }).then(j);
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);

const sign = (payload) =>
  crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
const near = (a, b, t = 0.02) => Math.abs(a - b) < t;
const uniq = (p) => `${p}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function run() {
  console.log('🚀 Running payment, pricing, coupon and referral tests...\n');
  const login = await post('/api/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert.strictEqual(login.status, 200);
  const A = { 'x-admin-token': login.body.token };

  const prod = await post('/api/products', {
    name: 'Payment Test Item', price: 1000, gstRate: 5, category: 'TestCat', fulfillmentKind: 'IMMEDIATE'
  }, A);
  assert.strictEqual(prod.status, 201);
  const productId = prod.body.id;

  // ---- 1. backend is authoritative ----
  console.log('1. Testing the backend ignores client-supplied prices and totals...');
  const tampered = await post('/api/cart/quote', {
    lines: [{ id: productId, quantity: 1, price: 1, unitPrice: 1, lineTotal: 1 }],
    totals: { calculatedTotal: 1 }, calculatedTotal: 1
  });
  assert.strictEqual(tampered.status, 200);
  assert.strictEqual(tampered.body.totals.calculatedTotal, 1050, 'server price wins (1000 + 5% GST)');

  const tamperedOrder = await post('/api/parent-orders', {
    customerName: 'Tamper Tester', customerPhone: '+919900001234',
    lines: [{ id: productId, quantity: 1, price: 1 }],
    calculatedTotal: 1, payableTotal: 1
  });
  assert.strictEqual(tamperedOrder.status, 201);
  assert.strictEqual(Number(tamperedOrder.body.parentOrder.payableTotal), 1050,
    'a client-sent payable total is ignored');
  console.log('   🔒 Client prices and totals ignored; server charged ₹1050');

  // ---- 2. platform pricing ----
  console.log('2. Testing platform pricing (WEB / ANDROID / IOS)...');
  const iosRule = await post('/api/platform-price-rules', {
    platform: 'IOS', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 20
  }, A);
  assert.strictEqual(iosRule.status, 201);
  await post('/api/platform-price-rules', {
    platform: 'PRODUCT_SCOPED_ANDROID', scope: 'GLOBAL', adjustmentType: 'FLAT', adjustmentValue: 5
  }, A).then((r) => assert.strictEqual(r.status, 400, 'an unknown platform is rejected'));
  await post('/api/platform-price-rules', {
    platform: 'ANDROID', scope: 'PRODUCT', scopeRef: productId, adjustmentType: 'FLAT', adjustmentValue: 50
  }, A);

  const web = await post('/api/cart/quote', { platform: 'WEB', lines: [{ id: productId, quantity: 1 }] });
  const ios = await post('/api/cart/quote', { platform: 'IOS', lines: [{ id: productId, quantity: 1 }] });
  const android = await post('/api/cart/quote', { platform: 'ANDROID', lines: [{ id: productId, quantity: 1 }] });
  const bogus = await post('/api/cart/quote', { platform: 'HACKED', lines: [{ id: productId, quantity: 1 }] });

  assert.strictEqual(web.body.totals.calculatedTotal, 1050);
  assert.strictEqual(ios.body.totals.calculatedTotal, 1260, 'IOS +20% → 1200 + GST');
  assert.strictEqual(android.body.totals.calculatedTotal, 1102.5, 'ANDROID +50 flat → 1050 + GST');
  assert.strictEqual(bogus.body.platform, 'WEB', 'an unknown platform degrades to WEB');
  assert.strictEqual(bogus.body.totals.calculatedTotal, 1050);
  console.log('   ✓ WEB ₹1050 · IOS ₹1260 · ANDROID ₹1102.50 · tampered platform → WEB');

  // ---- 3. coupons ----
  console.log('3. Testing coupon scopes, validity and single-use...');
  const globalCode = uniq('SAVE');
  const created = await post('/api/coupons', {
    code: globalCode, scope: 'GLOBAL', discountType: 'PERCENT', discountValue: 10, maxDiscountAmount: 150
  }, A);
  assert.strictEqual(created.status, 201);

  const check = await post('/api/coupons/validate', { code: globalCode, subtotal: 1000, phone: '9990001111' });
  assert.strictEqual(check.body.valid, true);
  assert.strictEqual(check.body.discount, 100);

  const capped = await post('/api/coupons/validate', { code: globalCode, subtotal: 5000, phone: '9990001111' });
  assert.strictEqual(capped.body.discount, 150, 'cap honoured');

  const unknown = await post('/api/coupons/validate', { code: 'NOPE-NOPE', subtotal: 1000, phone: '9990001111' });
  assert.strictEqual(unknown.body.valid, false);
  assert.strictEqual(unknown.body.reason, 'COUPON_NOT_FOUND');

  const phone = '+919900004321';
  const withCoupon = await post('/api/parent-orders', {
    customerName: 'Coupon Tester', customerPhone: phone,
    lines: [{ id: productId, quantity: 1 }], couponCode: globalCode
  });
  assert.strictEqual(withCoupon.status, 201);
  const po = withCoupon.body.parentOrder;
  assert.strictEqual(po.couponCode, globalCode);
  assert.ok(near(Number(po.couponDiscount), 105), `expected 105 off 1050, got ${po.couponDiscount}`);
  assert.ok(near(Number(po.payableTotal), 945), `expected 945, got ${po.payableTotal}`);

  const reuse = await post('/api/parent-orders', {
    customerName: 'Coupon Tester', customerPhone: phone,
    lines: [{ id: productId, quantity: 1 }], couponCode: globalCode
  });
  assert.strictEqual(reuse.status, 400);
  assert.strictEqual(reuse.body.code, 'COUPON_ALREADY_USED');
  console.log('   🔒 Coupon applied once (₹1050 → ₹945); reuse by the same customer blocked');

  // ---- 4. coupon concurrency ----
  console.log('4. Testing concurrent checkouts with one single-use coupon...');
  const raceCode = uniq('RACE');
  await post('/api/coupons', { code: raceCode, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 100 }, A);
  const racePhone = '+919900009999';
  const racers = await Promise.all(
    Array.from({ length: 5 }, () => post('/api/parent-orders', {
      customerName: 'Race Tester', customerPhone: racePhone,
      lines: [{ id: productId, quantity: 1 }], couponCode: raceCode
    }))
  );
  const accepted = racers.filter((r) => r.status === 201);
  const refused = racers.filter((r) => r.body?.code === 'COUPON_ALREADY_USED');
  assert.strictEqual(accepted.length, 1, `exactly one order may get the discount, got ${accepted.length}`);
  assert.strictEqual(refused.length, 4);
  console.log('   🔒 5 concurrent checkouts → 1 discounted order, 4 refused');

  // ---- 5. cohort + single-user ----
  console.log('5. Testing cohort and single-user coupons...');
  const cohortCode = uniq('COHORT');
  await post('/api/coupons', {
    code: cohortCode, scope: 'COHORT', discountType: 'FLAT', discountValue: 100,
    cohortUserIds: ['cohort-user-1']
  }, A);
  const outsider = await post('/api/coupons/validate', { code: cohortCode, subtotal: 1000, phone: '9990002222' });
  assert.strictEqual(outsider.body.valid, false, 'a non-member cannot use a cohort coupon');

  const singleCode = uniq('SOLO');
  await post('/api/coupons', {
    code: singleCode, scope: 'SINGLE_USER', singleUserId: 'someone-else',
    discountType: 'FLAT', discountValue: 100
  }, A);
  const notMine = await post('/api/coupons/validate', { code: singleCode, subtotal: 1000, phone: '9990003333' });
  assert.strictEqual(notMine.body.valid, false);
  assert.strictEqual(notMine.body.reason, 'COUPON_NOT_FOUND', 'must not reveal that it exists');
  console.log('   🔒 Cohort and single-user coupons invisible to outsiders');

  // ---- 6. referrals ----
  console.log('6. Testing referral signup, self-referral and duplicate reward...');
  await post('/api/referral-rules', { referrerAmount: 150, referredAmount: 100, minOrderAmount: 0 }, A);

  const mkUser = async (name) => {
    const r = await post('/api/auth/signup', {
      username: name, password: 'referral-pass-123',
      email: `${name}@example.com`, phone: `99${Date.now().toString().slice(-8)}`
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const referrer = await mkUser(uniq('refr').toLowerCase());
  const codeRes = await get('/api/me/referrals', { 'x-user-token': referrer.token });
  assert.strictEqual(codeRes.status, 200);
  const myCode = codeRes.body.code;
  assert.ok(myCode, 'a signed-in user always has a code');

  const selfTry = await post('/api/auth/signup', {
    username: uniq('self').toLowerCase(), password: 'referral-pass-123',
    email: `${uniq('self').toLowerCase()}@example.com`, phone: '9911110000', referralCode: myCode
  });
  assert.strictEqual(selfTry.status, 201, 'a bad code must not block signup');

  const referred = await post('/api/auth/signup', {
    username: uniq('newb').toLowerCase(), password: 'referral-pass-123',
    email: `${uniq('newb').toLowerCase()}@example.com`, phone: '9922220000', referralCode: myCode
  });
  assert.strictEqual(referred.status, 201);
  assert.strictEqual(referred.body.referral?.status, 'PENDING');

  const q1 = await post('/api/referrals/qualify', {
    referredUserId: referred.body.user.id, orderAmount: 500
  }, A);
  assert.strictEqual(q1.body.rewarded, true);

  const q2 = await post('/api/referrals/qualify', {
    referredUserId: referred.body.user.id, orderAmount: 500
  }, A);
  assert.strictEqual(q2.body.rewarded, false);
  assert.strictEqual(q2.body.reason, 'ALREADY_REWARDED');

  const summary = await get('/api/me/referrals', { 'x-user-token': referrer.token });
  assert.strictEqual(summary.body.rewarded, 1);
  console.log('   🔒 Referral rewarded once; a repeat grant refused');

  // ---- 7. webhook idempotency ----
  console.log('7. Testing webhook signature and duplicate-event handling...');
  const prep = await post('/api/checkout/prepare', {
    customerName: 'Webhook Tester', customerPhone: '+919900007777',
    items: [{ id: productId, quantity: 1 }], paymentMethod: 'online'
  });
  assert.strictEqual(prep.status, 200, JSON.stringify(prep.body));

  const payload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${crypto.randomBytes(6).toString('hex')}`,
          order_id: prep.body.razorpayOrderId,
          amount: Math.round(prep.body.amount * 100),
          method: 'upi'
        }
      }
    }
  };
  const eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;

  const badSig = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'deadbeef', 'x-razorpay-event-id': eventId },
    body: JSON.stringify(payload)
  }).then(j);
  assert.strictEqual(badSig.status, 400, 'a forged signature must be refused');

  const send = () => fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': sign(payload),
      'x-razorpay-event-id': eventId
    },
    body: JSON.stringify(payload)
  }).then(j);

  const first = await send();
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  const replay = await send();
  assert.strictEqual(replay.status, 200);
  assert.strictEqual(replay.body.reason, 'duplicate_event', 'a redelivered event must be a no-op');
  console.log('   🔒 Forged signature refused; redelivered event recognised as duplicate');

  // ---- 8. amount tampering in the webhook ----
  console.log('8. Testing a webhook with a mismatched or missing amount...');
  const prep2 = await post('/api/checkout/prepare', {
    customerName: 'Amount Tester', customerPhone: '+919900008888',
    items: [{ id: productId, quantity: 1 }], paymentMethod: 'online'
  });
  const wrongAmount = {
    event: 'payment.captured',
    payload: { payment: { entity: {
      id: `pay_${crypto.randomBytes(6).toString('hex')}`,
      order_id: prep2.body.razorpayOrderId, amount: 100   // ₹1, not the real total
    } } }
  };
  const wrong = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(wrongAmount),
               'x-razorpay-event-id': `evt_${crypto.randomBytes(6).toString('hex')}` },
    body: JSON.stringify(wrongAmount)
  }).then(j);
  assert.strictEqual(wrong.body.reason, 'amount_mismatch', 'an underpayment must not fulfil');

  const noAmount = {
    event: 'payment.captured',
    payload: { payment: { entity: {
      id: `pay_${crypto.randomBytes(6).toString('hex')}`, order_id: prep2.body.razorpayOrderId
    } } }
  };
  const missing = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(noAmount),
               'x-razorpay-event-id': `evt_${crypto.randomBytes(6).toString('hex')}` },
    body: JSON.stringify(noAmount)
  }).then(j);
  assert.strictEqual(missing.body.reason, 'amount_mismatch',
    'an event with no amount must fail CLOSED, not fulfil');
  console.log('   🔒 Wrong amount and missing amount both refused (fails closed)');

  // ---- 9. failed payment ----
  console.log('9. Testing a failed payment closes the checkout...');
  const failPayload = {
    event: 'payment.failed',
    payload: { payment: { entity: {
      id: `pay_${crypto.randomBytes(6).toString('hex')}`,
      order_id: prep2.body.razorpayOrderId, error_description: 'Card declined'
    } } }
  };
  const failed = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(failPayload),
               'x-razorpay-event-id': `evt_${crypto.randomBytes(6).toString('hex')}` },
    body: JSON.stringify(failPayload)
  }).then(j);
  assert.strictEqual(failed.status, 200);
  const afterFail = await post('/api/checkout/complete', { checkoutId: prep2.body.checkoutId });
  assert.strictEqual(afterFail.status, 400, 'a failed checkout cannot then be completed');
  console.log('   🔒 Failed payment marks the checkout failed; completion refused');

  // ---- 10. forged client-side verification ----
  console.log('10. Testing a forged payment signature at /checkout/complete...');
  const prep3 = await post('/api/checkout/prepare', {
    customerName: 'Forge Tester', customerPhone: '+919900006666',
    items: [{ id: productId, quantity: 1 }], paymentMethod: 'online'
  });
  const forged = await post('/api/checkout/complete', {
    checkoutId: prep3.body.checkoutId,
    razorpayOrderId: prep3.body.razorpayOrderId,
    razorpayPaymentId: 'pay_forged',
    razorpaySignature: 'f'.repeat(64)
  });
  assert.strictEqual(forged.status, 400);
  console.log('   🔒 Forged payment signature refused');

  console.log('\n🎉 PAYMENT, PRICING, COUPON & REFERRAL TESTS PASSED! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ PAYMENT TESTS FAILED:', err.message);
  process.exit(1);
});
