import assert from 'assert';

/**
 * Parent order / sub-order integration suite.
 * Exercises the split, every sub-order type, the status machine, retries, and
 * that pre-migration orders still behave exactly as before.
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};
const post = (path, body, headers = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }).then(json);
const patch = (path, body, headers = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }).then(json);
const get = (path, headers = {}) => fetch(`${BASE_URL}${path}`, { headers }).then(json);

async function adminLogin() {
  const { status, body } = await post('/api/admin/login', {
    username: ADMIN_USERNAME, password: ADMIN_PASSWORD
  });
  assert.strictEqual(status, 200, 'admin login must succeed');
  return body.token;
}

const CUSTOMER = { customerName: 'Parent Order Tester', customerPhone: '+919900000123' };
const ADDRESS = { line1: '12 MG Road', city: 'Bengaluru', state: 'KA', pincode: '560001' };
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

async function run() {
  console.log('🚀 Running parent order / sub-order tests...\n');
  const ADMIN = await adminLogin();
  const A = { 'x-admin-token': ADMIN };

  // ---- fixtures: one product of each shape ----
  console.log('1. Creating catalog fixtures for each fulfilment kind...');
  const mk = async (payload) => {
    const { status, body } = await post('/api/products', payload, A);
    assert.strictEqual(status, 201, `product create failed: ${JSON.stringify(body)}`);
    return body;
  };
  const immediate = await mk({
    name: 'Test Smoothie', price: 200, gstRate: 5, fulfillmentKind: 'IMMEDIATE', prepMinutes: 20
  });
  const sourced = await mk({
    name: 'Test Dry Fruits', price: 900, gstRate: 5, fulfillmentKind: 'DELIVERY_IN_DAYS', leadTimeDays: 5
  });
  const plannable = await mk({
    name: 'Test Pudding', price: 300, gstRate: 5, fulfillmentKind: 'IMMEDIATE', subscribable: true
  });
  assert.strictEqual(immediate.fulfillmentKind, 'IMMEDIATE');
  assert.strictEqual(sourced.fulfillmentKind, 'DELIVERY_IN_DAYS');
  assert.strictEqual(sourced.deliverLater, true, 'legacy boolean must stay in sync');
  assert.strictEqual(plannable.subscribable, true);
  console.log('   ✓ IMMEDIATE, DELIVERY_IN_DAYS and subscribable products created');

  // ---- 2. cart quote is server-authoritative ----
  console.log('2. Testing POST /api/cart/quote ignores client prices...');
  const quote = await post('/api/cart/quote', {
    lines: [{ id: immediate.id, quantity: 2, price: 1, lineTotal: 1 }]
  });
  assert.strictEqual(quote.status, 200);
  assert.strictEqual(quote.body.totals.calculatedTotal, 420, '200×2 +5% GST');
  console.log('   ✓ Quote computed from product rows, client amounts ignored');

  // ---- 3. immediate order ----
  console.log('3. Testing an IMMEDIATE parent order...');
  const imm = await post('/api/parent-orders', { ...CUSTOMER, lines: [{ id: immediate.id, quantity: 1 }] });
  assert.strictEqual(imm.status, 201, JSON.stringify(imm.body));
  assert.strictEqual(imm.body.subOrders.length, 1);
  assert.strictEqual(imm.body.subOrders[0].subOrderType, 'IMMEDIATE');
  assert.strictEqual(imm.body.subOrders[0].status, 'pending');
  assert.ok(imm.body.parentOrder.id.startsWith('par-'));
  console.log('   ✓ One parent, one IMMEDIATE sub-order at pending');

  // ---- 4. delivery-in-days order ----
  console.log('4. Testing a DELIVERY_IN_DAYS parent order...');
  const noAddr = await post('/api/parent-orders', { ...CUSTOMER, lines: [{ id: sourced.id, quantity: 1 }] });
  assert.strictEqual(noAddr.status, 400);
  assert.strictEqual(noAddr.body.code, 'NEEDS_DELIVERY_ADDRESS');

  const del = await post('/api/parent-orders', {
    ...CUSTOMER, lines: [{ id: sourced.id, quantity: 1 }], deliveryAddress: ADDRESS
  });
  assert.strictEqual(del.status, 201);
  assert.strictEqual(del.body.subOrders[0].subOrderType, 'DELIVERY_IN_DAYS');
  assert.ok(del.body.subOrders[0].expectedShipDate, 'lead time must produce a ship date');
  console.log('   ✓ Address required, and an expected ship date is set');

  // ---- 5. scheduled order ----
  console.log('5. Testing a SCHEDULED one-time order...');
  const sched = await post('/api/parent-orders', {
    ...CUSTOMER, lines: [{ id: immediate.id, quantity: 1, scheduledFor: inHours(6) }]
  });
  assert.strictEqual(sched.status, 201);
  const schedSub = sched.body.subOrders[0];
  assert.strictEqual(schedSub.subOrderType, 'SCHEDULED');
  assert.strictEqual(schedSub.status, 'scheduled');
  assert.strictEqual(schedSub.subscriptionId, null, 'a scheduled order must never be recurring');
  console.log('   ✓ SCHEDULED sub-order created with no subscription reference');

  // ---- 6. invalid scheduling ----
  console.log('6. Testing invalid scheduling is refused...');
  const tooSoon = await post('/api/parent-orders', {
    ...CUSTOMER, lines: [{ id: immediate.id, quantity: 1, scheduledFor: inHours(0.1) }]
  });
  assert.strictEqual(tooSoon.status, 400);
  assert.strictEqual(tooSoon.body.code, 'SCHEDULE_TOO_SOON');

  const tooFar = await post('/api/parent-orders', {
    ...CUSTOMER, lines: [{ id: immediate.id, quantity: 1, scheduledFor: inHours(24 * 60) }]
  });
  assert.strictEqual(tooFar.body.code, 'SCHEDULE_TOO_FAR');

  const notSchedulable = await post('/api/parent-orders', {
    ...CUSTOMER, lines: [{ id: sourced.id, quantity: 1, scheduledFor: inHours(6) }], deliveryAddress: ADDRESS
  });
  assert.strictEqual(notSchedulable.body.code, 'NOT_SCHEDULABLE');
  console.log('   ✓ Too soon, too far, and non-schedulable products all rejected');

  // ---- 7. subscription order ----
  console.log('7. Testing a SUBSCRIPTION order...');
  const subQuote = await post('/api/subscriptions/quote', {
    productId: plannable.id, frequency: 'ALTERNATE_DAYS', durationMonths: 2
  });
  assert.strictEqual(subQuote.status, 200);
  assert.strictEqual(subQuote.body.deliveryCount, 30);
  assert.strictEqual(subQuote.body.discountPercent, 14);

  const subOrder = await post('/api/parent-orders', {
    ...CUSTOMER,
    lines: [{ id: plannable.id, purchaseMode: 'SUBSCRIPTION', frequency: 'ALTERNATE_DAYS', durationMonths: 2 }]
  });
  assert.strictEqual(subOrder.status, 201, JSON.stringify(subOrder.body));
  assert.strictEqual(subOrder.body.subOrders.length, 0, 'a plan must not flood the board with sub-orders');
  assert.strictEqual(subOrder.body.subscriptions.length, 1);
  const plan = subOrder.body.subscriptions[0];
  assert.strictEqual(plan.deliveryCount, 30);
  assert.strictEqual(plan.status, 'PENDING_PAYMENT', 'unpaid counter plan stays pending');
  console.log(`   ✓ Plan created: ${plan.deliveryCount} deliveries, ${plan.discountPercent}% off, ₹${plan.totalAmount}`);

  const badPlan = await post('/api/parent-orders', {
    ...CUSTOMER,
    lines: [{ id: immediate.id, purchaseMode: 'SUBSCRIPTION', frequency: 'DAILY', durationMonths: 1 }]
  });
  assert.strictEqual(badPlan.body.code, 'NOT_SUBSCRIBABLE');
  console.log('   ✓ A non-subscribable product cannot be put on a plan');

  // ---- 8. mixed cart ----
  console.log('8. Testing a mixed cart splits into parent + sub-orders...');
  const mixed = await post('/api/parent-orders', {
    ...CUSTOMER,
    deliveryAddress: ADDRESS,
    lines: [
      { id: immediate.id, quantity: 1 },
      { id: sourced.id, quantity: 1 },
      { id: immediate.id, quantity: 2, scheduledFor: inHours(8) },
      { id: plannable.id, purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }
    ]
  });
  assert.strictEqual(mixed.status, 201, JSON.stringify(mixed.body));
  const types = mixed.body.subOrders.map((o) => o.subOrderType).sort();
  assert.deepStrictEqual(types, ['DELIVERY_IN_DAYS', 'IMMEDIATE', 'SCHEDULED']);
  assert.strictEqual(mixed.body.subscriptions.length, 1);
  const parentId = mixed.body.parentOrder.id;
  for (const so of mixed.body.subOrders) {
    assert.strictEqual(so.parentOrderId, parentId, 'every sub-order hangs off one parent');
  }
  console.log('   ✓ 1 parent → 3 sub-orders + 1 plan, all sharing the parent id');

  // ---- 9. parent totals reconcile ----
  console.log('9. Testing parent totals reconcile against sub-orders and items...');
  const detail = await get(`/api/parent-orders/${parentId}`, A);
  assert.strictEqual(detail.status, 200);
  const subTotal = detail.body.subOrders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const planTotal = mixed.body.subscriptions[0].totalAmount;
  const parentCalc = Number(detail.body.parentOrder.calculatedTotal);
  assert.ok(Math.abs(parentCalc - (subTotal + planTotal)) < 0.02,
    `parent ${parentCalc} vs parts ${subTotal + planTotal}`);
  for (const so of detail.body.subOrders) {
    const items = detail.body.items.filter((i) => i.subOrderId === so.id);
    assert.ok(items.length > 0, 'every sub-order has order_items rows');
    const lineSum = items.reduce((s, i) => s + Number(i.lineTotal), 0);
    assert.ok(Math.abs(lineSum - Number(so.totalAmount)) < 0.02, 'items must sum to the sub-order total');
  }
  console.log('   ✓ Parent = Σ sub-orders + plans; each sub-order = Σ its items');

  // ---- 10. status transitions per type ----
  console.log('10. Testing per-type status workflows...');
  const immId = mixed.body.subOrders.find((o) => o.subOrderType === 'IMMEDIATE').id;
  const delId = mixed.body.subOrders.find((o) => o.subOrderType === 'DELIVERY_IN_DAYS').id;
  const scId = mixed.body.subOrders.find((o) => o.subOrderType === 'SCHEDULED').id;

  for (const s of ['preparing', 'ready', 'out_for_delivery', 'delivered']) {
    const r = await patch(`/api/orders/${immId}/status`, { status: s }, A);
    assert.strictEqual(r.status, 200, `immediate → ${s} failed: ${JSON.stringify(r.body)}`);
  }
  for (const s of ['sourcing', 'packed', 'shipped', 'delivered']) {
    const r = await patch(`/api/orders/${delId}/status`, { status: s }, A);
    assert.strictEqual(r.status, 200, `delivery → ${s} failed: ${JSON.stringify(r.body)}`);
  }
  const scStart = await patch(`/api/orders/${scId}/status`, { status: 'preparing' }, A);
  assert.strictEqual(scStart.status, 200, 'scheduled → preparing');
  console.log('   ✓ Immediate, delivery-in-days and scheduled each follow their own path');

  // ---- 11. invalid transitions ----
  console.log('11. Testing invalid status transitions are refused...');
  const backwards = await patch(`/api/orders/${immId}/status`, { status: 'preparing' }, A);
  assert.strictEqual(backwards.status, 400, 'delivered is terminal');
  assert.strictEqual(backwards.body.code, 'INVALID_STATUS_TRANSITION');

  const crossType = await patch(`/api/orders/${scId}/status`, { status: 'sourcing' }, A);
  assert.strictEqual(crossType.status, 400, 'sourcing is unreachable from a kitchen order');

  const fresh = await post('/api/parent-orders', { ...CUSTOMER, lines: [{ id: immediate.id, quantity: 1 }] });
  const skip = await patch(`/api/orders/${fresh.body.subOrders[0].id}/status`, { status: 'delivered' }, A);
  assert.strictEqual(skip.status, 400, 'cannot skip straight to delivered');
  console.log('   🔒 Backward, cross-type and skipped transitions all blocked');

  // ---- 12. retry / duplicate checkout ----
  console.log('12. Testing checkout retry does not duplicate orders...');
  const prep = await post('/api/checkout/prepare', {
    ...CUSTOMER, items: [{ id: immediate.id, quantity: 1 }], paymentMethod: 'counter'
  });
  assert.strictEqual(prep.status, 200);
  const first = await post('/api/checkout/complete', { checkoutId: prep.body.checkoutId });
  assert.strictEqual(first.status, 201);
  const firstIds = (first.body.orders || []).map((o) => o.id).sort();

  const replay = await post('/api/checkout/complete', { checkoutId: prep.body.checkoutId });
  assert.ok([200, 409].includes(replay.status), `replay status ${replay.status}`);
  if (replay.status === 200) {
    assert.deepStrictEqual((replay.body.orders || []).map((o) => o.id).sort(), firstIds,
      'a replay must return the same orders, never new ones');
  }
  console.log('   🔒 Replayed completion returned the same orders');

  // ---- 13. existing order compatibility ----
  console.log('13. Testing pre-migration orders still work...');
  const legacy = await post('/api/orders', {
    ...CUSTOMER, items: [{ id: immediate.id, quantity: 1 }]
  });
  assert.strictEqual(legacy.status, 201, JSON.stringify(legacy.body));
  const legacyOrder = legacy.body.orders ? legacy.body.orders[0] : legacy.body.order || legacy.body;
  assert.ok(legacyOrder.id, 'legacy endpoint still creates an order');
  assert.ok(['immediate', 'delivery'].includes(legacyOrder.fulfillmentType),
    'legacy fulfillment_type column is still populated');

  const legacyFlow = await patch(`/api/orders/${legacyOrder.id}/status`, { status: 'preparing' }, A);
  assert.strictEqual(legacyFlow.status, 200, 'old orders still transition');
  const legacyReady = await patch(`/api/orders/${legacyOrder.id}/status`, { status: 'ready' }, A);
  assert.strictEqual(legacyReady.status, 200);
  const legacyDone = await patch(`/api/orders/${legacyOrder.id}/status`, { status: 'completed' }, A);
  assert.strictEqual(legacyDone.status, 200, 'the old completed state is still reachable');

  const list = await get('/api/orders', A);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.length > 0, 'admin list still returns every order');
  console.log('   ✓ Legacy create, legacy vocabulary and admin list all unaffected');

  console.log('\n🎉 PARENT ORDER & SUB-ORDER TESTS PASSED! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ PARENT ORDER TESTS FAILED:', err.message);
  process.exit(1);
});
