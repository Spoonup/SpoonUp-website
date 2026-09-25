import assert from 'assert';
import crypto from 'crypto';

/**
 * Regression suite for the production blockers:
 *   - online checkout must create a parent order, not the legacy split
 *   - a paid subscription must fund its wallet exactly once
 *   - no replay, retry or failed payment may fund it twice or at all
 *   - the scheduler endpoint must be secret-gated and idempotent
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-webhook-secret';
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET || 'test-scheduler-secret';

const j = async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) });
const call = (m, p, b, h = {}) =>
  fetch(`${BASE_URL}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json', ...h },
    body: b === undefined ? undefined : JSON.stringify(b)
  }).then(j);
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);
const sign = (o) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(o)).digest('hex');
const near = (a, b, t = 0.02) => Math.abs(Number(a) - Number(b)) < t;
const ids = (checkoutId) => {
  const base = checkoutId.replace(/^chk-/, '');
  return { parent: `par-${base}`, sub: `sub-${base}-0`, wallet: `wal-${base}-0` };
};

async function run() {
  console.log('🚀 Running checkout funding + scheduler regression tests...\n');
  const A = { 'x-admin-token': (await post('/api/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD })).b.token };

  const mk = async (payload) => (await post('/api/products', payload, A)).b;
  const now = await mk({ name: 'CF Immediate', price: 200, gstRate: 5, fulfillmentKind: 'IMMEDIATE' });
  const sourced = await mk({ name: 'CF Sourced', price: 900, gstRate: 5, fulfillmentKind: 'DELIVERY_IN_DAYS', leadTimeDays: 4 });
  const plan = await mk({ name: 'CF Plan', price: 300, gstRate: 5, fulfillmentKind: 'IMMEDIATE', subscribable: true });
  const ADDRESS = { line1: '9 Church Street', city: 'Bengaluru', state: 'KA', pincode: '560001' };

  const payOnline = async (prep, eventId, payId) => {
    const ev = {
      event: 'payment.captured',
      payload: { payment: { entity: {
        id: payId, order_id: prep.razorpayOrderId,
        amount: Math.round(prep.amount * 100), notes: { checkoutId: prep.checkoutId }
      } } }
    };
    return fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(ev), 'x-razorpay-event-id': eventId },
      body: JSON.stringify(ev)
    }).then(j);
  };

  // ---- 1. every cart type fulfils through the parent-order path ----
  console.log('1. Testing online checkout produces a PARENT ORDER for every cart type...');
  const carts = [
    ['immediate', [{ id: now.id, quantity: 1 }], null, ['IMMEDIATE']],
    ['delivery-in-days', [{ id: sourced.id, quantity: 1 }], ADDRESS, ['DELIVERY_IN_DAYS']],
    ['scheduled', [{ id: now.id, quantity: 1, scheduledFor: new Date(Date.now() + 6 * 3600e3).toISOString() }], null, ['SCHEDULED']],
    ['mixed', [
      { id: now.id, quantity: 1 },
      { id: sourced.id, quantity: 1 },
      { id: plan.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }
    ], ADDRESS, ['DELIVERY_IN_DAYS', 'IMMEDIATE']]
  ];

  for (const [label, lines, address, expectTypes] of carts) {
    const prep = (await post('/api/checkout/prepare', {
      customerName: 'CF Buyer', customerPhone: '+919900100001',
      paymentMethod: 'online', lines, deliveryAddress: address
    })).b;
    assert.ok(prep.checkoutId, `${label}: prepare failed: ${JSON.stringify(prep)}`);

    const wh = await payOnline(prep, `cf-${label}`, `pay_cf_${label}`);
    assert.strictEqual(wh.s, 200, `${label}: webhook ${JSON.stringify(wh.b)}`);

    const { parent } = ids(prep.checkoutId);
    const detail = await get(`/api/parent-orders/${parent}`, A);
    assert.strictEqual(detail.s, 200, `${label}: no parent order was created`);
    const types = [...new Set(detail.b.subOrders.map((o) => o.subOrderType))].sort();
    assert.deepStrictEqual(types, expectTypes, `${label}: got ${types.join(',')}`);
    assert.strictEqual(detail.b.parentOrder.paymentStatus, 'paid', `${label}: parent must be paid`);
    for (const so of detail.b.subOrders) {
      assert.strictEqual(so.parentOrderId, parent, `${label}: sub-order must hang off the parent`);
    }
    console.log(`   ✓ ${label.padEnd(17)} -> parent + [${types.join(', ')}]`);
  }

  // ---- 2. THE BLOCKER: a paid subscription funds its wallet ----
  console.log('2. Testing a paid subscription funds its wallet exactly once...');
  const prep = (await post('/api/checkout/prepare', {
    customerName: 'CF Plan Buyer', customerPhone: '+919900100002',
    paymentMethod: 'online',
    lines: [{ id: plan.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }]
  })).b;
  const K = ids(prep.checkoutId);

  const before = await get(`/api/subscriptions/${K.sub}`, A);
  assert.strictEqual(before.s, 404, 'nothing may exist before payment');

  const payId = `pay_cf_fund_${crypto.randomBytes(4).toString('hex')}`;
  assert.strictEqual((await payOnline(prep, 'cf-fund-1', payId)).s, 200);

  const sub = await get(`/api/subscriptions/${K.sub}`, A);
  assert.strictEqual(sub.s, 200, 'the subscription must exist after payment');
  assert.strictEqual(sub.b.subscription.status, 'ACTIVE');
  assert.ok(near(sub.b.walletBalance, sub.b.subscription.totalAmount),
    `wallet ${sub.b.walletBalance} must equal plan total ${sub.b.subscription.totalAmount}`);
  const st = await get(`/api/wallets/${K.wallet}/statement`, A);
  assert.strictEqual(st.b.transactions.length, 1);
  assert.strictEqual(st.b.transactions[0].type, 'SUBSCRIPTION_TOPUP');
  assert.strictEqual(st.b.transactions[0].idempotencyKey, `topup:${K.sub}`);
  assert.strictEqual(st.b.wallet.isWithdrawable, false);
  console.log(`   ✓ Wallet funded ₹${sub.b.walletBalance}; one TOPUP row keyed topup:<subscriptionId>`);

  // ---- 3. no replay path may fund twice ----
  console.log('3. Testing replays cannot fund or create twice...');
  const balance = async () => (await get(`/api/wallets/${K.wallet}/statement`, A)).b.balance;
  const rows = async () => (await get(`/api/wallets/${K.wallet}/statement`, A)).b.transactions.length;
  const subOrders = async () => (await get(`/api/orders`, A)).b.filter((o) => o.parentOrderId === K.parent).length;
  const base = { bal: await balance(), rows: await rows(), orders: await subOrders() };

  // same event id (redelivery)
  await payOnline(prep, 'cf-fund-1', payId);
  // different event ids, same payment — bypasses the event journal entirely
  await payOnline(prep, 'cf-fund-2', payId);
  await payOnline(prep, 'cf-fund-3', payId);
  // client callback replays, in parallel
  const completes = await Promise.all(Array.from({ length: 5 }, () =>
    post('/api/checkout/complete', { checkoutId: prep.checkoutId })));
  assert.ok(completes.every((r) => r.s === 200), 'replayed completes must not error');

  assert.ok(near(await balance(), base.bal), 'balance must not move on replay');
  assert.strictEqual(await rows(), base.rows, 'no second ledger row');
  assert.strictEqual(await subOrders(), base.orders, 'no duplicate sub-orders');
  console.log(`   🔒 3 webhook replays + 5 parallel callbacks -> balance ₹${base.bal}, ${base.rows} ledger row, ${base.orders} sub-orders`);

  // ---- 4. failed and unverified payments never fund ----
  console.log('4. Testing failed and unverified payments create nothing...');
  const failPrep = (await post('/api/checkout/prepare', {
    customerName: 'CF Fail', customerPhone: '+919900100003', paymentMethod: 'online',
    lines: [{ id: plan.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }]
  })).b;
  const FK = ids(failPrep.checkoutId);
  const failEv = { event: 'payment.failed', payload: { payment: { entity: {
    id: 'pay_cf_failed', order_id: failPrep.razorpayOrderId, error_description: 'Declined',
    notes: { checkoutId: failPrep.checkoutId } } } } };
  await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(failEv), 'x-razorpay-event-id': 'cf-failed' },
    body: JSON.stringify(failEv)
  });
  assert.strictEqual((await get(`/api/subscriptions/${FK.sub}`, A)).s, 404, 'a failed payment must not create a plan');
  assert.strictEqual((await get(`/api/wallets/${FK.wallet}/statement`, A)).s, 404, 'a failed payment must not create a wallet');
  assert.strictEqual((await post('/api/checkout/complete', { checkoutId: failPrep.checkoutId })).s, 400);

  const forgePrep = (await post('/api/checkout/prepare', {
    customerName: 'CF Forge', customerPhone: '+919900100004', paymentMethod: 'online',
    lines: [{ id: plan.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }]
  })).b;
  const forged = await post('/api/checkout/complete', {
    checkoutId: forgePrep.checkoutId, razorpayOrderId: forgePrep.razorpayOrderId,
    razorpayPaymentId: 'pay_forged', razorpaySignature: 'f'.repeat(64)
  });
  assert.strictEqual(forged.s, 400, 'a forged signature must be refused');
  assert.strictEqual((await get(`/api/wallets/${ids(forgePrep.checkoutId).wallet}/statement`, A)).s, 404,
    'an unverified payment must not fund anything');
  console.log('   🔒 Failed payment and forged signature both created no plan, no wallet, no ledger');

  // ---- 5. scheduler endpoint ----
  console.log('5. Testing the scheduler endpoint is secret-gated and idempotent...');
  const JOB = '/api/jobs/run-due-deliveries';
  assert.strictEqual((await post(JOB, {})).s, 401, 'no secret must be refused');
  assert.strictEqual((await post(JOB, {}, { 'x-scheduler-secret': 'wrong' })).s, 401, 'a wrong secret must be refused');
  assert.strictEqual((await post(JOB, {}, A)).s, 401, 'an admin session is not a scheduler credential');

  const S = { 'x-scheduler-secret': SCHEDULER_SECRET };
  const asOf = new Date(Date.now() + 40 * 86400e3).toISOString().slice(0, 10);
  const plannedBefore = (await get(`/api/subscriptions/${K.sub}`, A)).b.deliveries.filter((d) => d.status === 'PLANNED').length;

  const first = await post(JOB, { onDate: asOf }, S);
  assert.strictEqual(first.s, 200, JSON.stringify(first.b));
  assert.ok(first.b.generated > 0, `the scheduler must generate due deliveries (attempted ${first.b.attempted})`);

  const second = await post(JOB, { onDate: asOf }, S);
  assert.strictEqual(second.b.generated, 0, 'a second run must generate nothing');

  const after = await get(`/api/subscriptions/${K.sub}`, A);
  const generated = after.b.deliveries.filter((d) => d.subOrderId);
  // run-due spans every subscription, so first.b.generated counts other plans
  // too. Assert against this plan's own schedule instead.
  const plannedAfter = after.b.deliveries.filter((d) => d.status === 'PLANNED').length;
  assert.ok(plannedAfter < plannedBefore, `this plan's schedule must advance (${plannedBefore} -> ${plannedAfter})`);
  assert.strictEqual(plannedAfter + generated.length, after.b.deliveries.length,
    'every delivery is either still planned or has a sub-order');
  const dupes = new Set(generated.map((d) => d.subOrderId));
  assert.strictEqual(dupes.size, generated.length, 'no delivery may have two sub-orders');
  console.log(`   🔒 Gated; ran ${first.b.generated}, re-run 0, this plan ${plannedBefore}->${plannedAfter} planned, no duplicate sub-orders`);

  // ---- 6. concurrent scheduler runs ----
  console.log('6. Testing concurrent scheduler instances debit once...');
  const planned = after.b.deliveries.find((d) => d.status === 'PLANNED');
  if (planned) {
    const balBefore = (await get(`/api/wallets/${K.wallet}/statement`, A)).b.balance;
    const racers = await Promise.all(Array.from({ length: 6 }, () =>
      post('/api/subscriptions/deliveries/' + planned.id + '/run', {}, A)));
    assert.strictEqual(racers.filter((r) => r.b.ran === true).length, 1, 'exactly one run may win');
    const balAfter = (await get(`/api/wallets/${K.wallet}/statement`, A)).b.balance;
    assert.ok(near(balAfter, balBefore - planned.amountDue), 'exactly one debit');
    const orders = (await get('/api/orders', A)).b.filter((o) => o.subscriptionDeliveryId === planned.id);
    assert.strictEqual(orders.length, 1, 'exactly one sub-order');
    console.log('   🔒 6 concurrent runs -> 1 winner, 1 debit, 1 sub-order');
  } else {
    console.log('   ℹ every delivery already generated; covered by test-subscriptions.js');
  }

  console.log('\n🎉 CHECKOUT FUNDING & SCHEDULER TESTS PASSED! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ CHECKOUT FUNDING TESTS FAILED:', err.message);
  process.exit(1);
});
