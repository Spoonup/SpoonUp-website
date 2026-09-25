import assert from 'assert';

/**
 * Subscription lifecycle + financial integrity, end to end against a live server.
 * Covers funding, delivery generation, duplicate protection, concurrency,
 * failure reversal, adjustments, skip, pause and cancel.
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 5001}`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'spoonadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const call = (method, path, body, headers = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(j);
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);
const patch = (p, b, h) => call('PATCH', p, b, h);

const CUSTOMER = { customerName: 'Plan Tester', customerPhone: '+919900000777' };
const near = (a, b, tol = 0.02) => Math.abs(a - b) < tol;

async function run() {
  console.log('🚀 Running subscription + wallet integrity tests...\n');

  const login = await post('/api/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert.strictEqual(login.status, 200, 'admin login must succeed');
  const A = { 'x-admin-token': login.body.token };

  // ---- fixture ----
  const prod = await post('/api/products', {
    name: 'Plan Pudding', price: 300, gstRate: 5,
    fulfillmentKind: 'IMMEDIATE', subscribable: true
  }, A);
  assert.strictEqual(prod.status, 201);
  const productId = prod.body.id;

  // ---- 1. discount is driven by order count, not duration ----
  console.log('1. Testing discount is based on ORDER COUNT, not duration...');
  const daily1m = await post('/api/subscriptions/quote', { productId, frequency: 'DAILY', durationMonths: 1 });
  const alt2m = await post('/api/subscriptions/quote', { productId, frequency: 'ALTERNATE_DAYS', durationMonths: 2 });
  assert.strictEqual(daily1m.body.deliveryCount, 30);
  assert.strictEqual(alt2m.body.deliveryCount, 30);
  assert.strictEqual(daily1m.body.discountPercent, alt2m.body.discountPercent);
  assert.strictEqual(daily1m.body.totalAmount, alt2m.body.totalAmount);
  const weekly3m = await post('/api/subscriptions/quote', { productId, frequency: 'WEEKLY', durationMonths: 3 });
  assert.strictEqual(weekly3m.body.deliveryCount, 12);
  assert.ok(weekly3m.body.discountPercent < daily1m.body.discountPercent,
    'fewer deliveries over a LONGER duration must earn a smaller discount');
  console.log(`   ✓ 30 deliveries = ${daily1m.body.discountPercent}% whether over 1 or 2 months; 12 over 3 months = ${weekly3m.body.discountPercent}%`);

  // ---- 2. plan creation ----
  console.log('2. Creating a plan and checking the schedule...');
  const created = await post('/api/parent-orders', {
    ...CUSTOMER,
    lines: [{ id: productId, purchaseMode: 'SUBSCRIPTION', frequency: 'DAILY', durationMonths: 1 }]
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const plan = created.body.subscriptions[0];
  assert.strictEqual(plan.status, 'PENDING_PAYMENT');
  assert.strictEqual(created.body.subOrders.length, 0, 'no sub-orders until each delivery runs');

  const detail0 = await get(`/api/subscriptions/${plan.id}`, A);
  assert.strictEqual(detail0.body.deliveries.length, 30);
  assert.ok(detail0.body.deliveries.every((d) => d.status === 'PLANNED'));
  assert.strictEqual(detail0.body.walletBalance, 0, 'unpaid plan is unfunded');
  console.log(`   ✓ 30 PLANNED deliveries, wallet ₹0 while unpaid`);

  // ---- 3. an unpaid plan cannot generate deliveries ----
  console.log('3. Testing an unpaid plan cannot draw deliveries...');
  const firstDelivery = detail0.body.deliveries[0];
  const unpaidRun = await post(`/api/subscriptions/deliveries/${firstDelivery.id}/run`, {}, A);
  assert.strictEqual(unpaidRun.body.ran, false);
  assert.strictEqual(unpaidRun.body.reason, 'SUBSCRIPTION_UNPAID');
  console.log('   🔒 Unpaid plan refused');

  // ---- 4. funding ----
  console.log('4. Testing upfront funding credits the wallet exactly once...');
  const paid = await post(`/api/subscriptions/${plan.id}/mark-paid`, {}, A);
  assert.strictEqual(paid.status, 200);
  assert.strictEqual(paid.body.duplicate, false);
  const funded = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(funded.body.walletBalance, plan.totalAmount), `balance ${funded.body.walletBalance} vs ${plan.totalAmount}`);
  assert.strictEqual(funded.body.subscription.status, 'ACTIVE');

  const doubleFund = await post(`/api/subscriptions/${plan.id}/mark-paid`, {}, A);
  assert.strictEqual(doubleFund.body.duplicate, true, 'second funding must be a no-op');
  const afterDouble = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterDouble.body.walletBalance, plan.totalAmount), 'credited once, not twice');
  console.log(`   🔒 Wallet funded ₹${plan.totalAmount}; duplicate credit rejected`);

  // ---- 5. a delivery debits and creates a sub-order ----
  console.log('5. Testing a delivery debits the wallet and creates a sub-order...');
  const before = afterDouble.body.walletBalance;
  const run1 = await post(`/api/subscriptions/deliveries/${firstDelivery.id}/run`, {}, A);
  assert.strictEqual(run1.status, 200, JSON.stringify(run1.body));
  assert.strictEqual(run1.body.ran, true);
  const subOrder = run1.body.subOrder;
  assert.strictEqual(subOrder.subOrderType, 'SUBSCRIPTION_DELIVERY');
  assert.strictEqual(subOrder.subscriptionId, plan.id, 'the sub-order references its plan');
  assert.strictEqual(subOrder.subscriptionDeliveryId, firstDelivery.id);
  assert.strictEqual(subOrder.status, 'scheduled');
  assert.strictEqual(subOrder.paymentStatus, 'paid', 'already funded; never collected again');

  const afterRun = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterRun.body.walletBalance, before - firstDelivery.amountDue),
    `expected ${before - firstDelivery.amountDue}, got ${afterRun.body.walletBalance}`);
  const d1 = afterRun.body.deliveries.find((d) => d.id === firstDelivery.id);
  assert.strictEqual(d1.status, 'GENERATED');
  assert.ok(d1.subOrderId, 'delivery references its sub-order');
  assert.ok(d1.walletTransactionId, 'delivery references its wallet deduction');
  console.log(`   ✓ Debited ₹${firstDelivery.amountDue}; delivery links to both sub-order and ledger row`);

  // ---- 6. duplicate delivery run ----
  console.log('6. Testing a repeated run cannot duplicate the order or the debit...');
  const replay = await post(`/api/subscriptions/deliveries/${firstDelivery.id}/run`, {}, A);
  assert.strictEqual(replay.body.ran, false);
  assert.strictEqual(replay.body.reason, 'ALREADY_PROCESSED');
  const afterReplay = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterReplay.body.walletBalance, afterRun.body.walletBalance), 'balance unchanged');
  console.log('   🔒 Replay refused; balance untouched');

  // ---- 7. concurrency ----
  console.log('7. Testing concurrent runs of one delivery...');
  const target = afterReplay.body.deliveries.find((d) => d.status === 'PLANNED');
  const balBefore = afterReplay.body.walletBalance;
  const racers = await Promise.all(
    Array.from({ length: 6 }, () => post(`/api/subscriptions/deliveries/${target.id}/run`, {}, A))
  );
  const winners = racers.filter((r) => r.body.ran === true);
  assert.strictEqual(winners.length, 1, `exactly one run may win, got ${winners.length}`);
  const afterRace = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterRace.body.walletBalance, balBefore - target.amountDue),
    'exactly one debit despite six concurrent calls');
  const orders = await get('/api/orders', A);
  const forDelivery = orders.body.filter((o) => o.subscriptionDeliveryId === target.id);
  assert.strictEqual(forDelivery.length, 1, 'exactly one sub-order for that delivery');
  console.log('   🔒 6 concurrent runs → 1 winner, 1 debit, 1 sub-order');

  // ---- 8. failed delivery is reversed ----
  console.log('8. Testing a failed delivery returns the money...');
  const balPreFail = afterRace.body.walletBalance;
  const failed = await post(`/api/subscriptions/deliveries/${target.id}/fail`, { reason: 'Rider could not deliver' }, A);
  assert.strictEqual(failed.status, 200);
  assert.strictEqual(failed.body.changed, true);
  const afterFail = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterFail.body.walletBalance, balPreFail + target.amountDue), 'entitlement returned');
  assert.strictEqual(afterFail.body.deliveries.find((d) => d.id === target.id).status, 'FAILED');

  const failAgain = await post(`/api/subscriptions/deliveries/${target.id}/fail`, {}, A);
  assert.strictEqual(failAgain.body.changed, false, 'cannot fail twice');
  const afterFail2 = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterFail2.body.walletBalance, afterFail.body.walletBalance), 'no second reversal');
  console.log('   🔒 Reversed once; a second failure is a no-op');

  // ---- 9. skip ----
  console.log('9. Testing skip never touches the wallet...');
  const toSkip = afterFail2.body.deliveries.find((d) => d.status === 'PLANNED');
  const balPreSkip = afterFail2.body.walletBalance;
  const skipped = await post(`/api/subscriptions/deliveries/${toSkip.id}/skip`, {}, A);
  assert.strictEqual(skipped.body.changed, true);
  const afterSkip = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterSkip.body.walletBalance, balPreSkip), 'a skip is never debited');
  assert.strictEqual(afterSkip.body.deliveries.find((d) => d.id === toSkip.id).status, 'SKIPPED');
  const skipRun = await post(`/api/subscriptions/deliveries/${toSkip.id}/run`, {}, A);
  assert.strictEqual(skipRun.body.ran, false, 'a skipped delivery cannot be run');
  console.log('   ✓ Skipped without debit, and not runnable afterwards');

  // ---- 10. pause / resume / cancel ----
  console.log('10. Testing pause, resume and cancel...');
  await patch(`/api/subscriptions/${plan.id}/status`, { status: 'PAUSED' }, A);
  const pausedState = await get(`/api/subscriptions/${plan.id}`, A);
  const nextPlanned = pausedState.body.deliveries.find((d) => d.status === 'PLANNED');
  const pausedRun = await post(`/api/subscriptions/deliveries/${nextPlanned.id}/run`, {}, A);
  assert.strictEqual(pausedRun.body.ran, false);
  assert.strictEqual(pausedRun.body.reason, 'SUBSCRIPTION_PAUSED');

  await patch(`/api/subscriptions/${plan.id}/status`, { status: 'ACTIVE' }, A);
  const resumed = await post(`/api/subscriptions/deliveries/${nextPlanned.id}/run`, {}, A);
  assert.strictEqual(resumed.body.ran, true, 'resuming allows deliveries again');

  const bad = await patch(`/api/subscriptions/${plan.id}/status`, { status: 'BANANA' }, A);
  assert.strictEqual(bad.status, 400);
  console.log('   ✓ Paused blocks delivery, resume restores it, bad status rejected');

  // ---- 11. admin adjustment ----
  console.log('11. Testing admin adjustments are auditable and idempotent...');
  const st = await get(`/api/subscriptions/${plan.id}`, A);
  const walletId = st.body.subscription.walletId;
  const balPreAdj = st.body.walletBalance;
  const adj = await post(`/api/wallets/${walletId}/adjust`,
    { amount: -100, reason: 'Correcting an over-credit', reference: `test-adj-${plan.id}` }, A);
  assert.strictEqual(adj.status, 200);
  assert.strictEqual(adj.body.transaction.direction, 'DEBIT');

  const adjReplay = await post(`/api/wallets/${walletId}/adjust`,
    { amount: -100, reason: 'Correcting an over-credit', reference: `test-adj-${plan.id}` }, A);
  assert.strictEqual(adjReplay.body.duplicate, true, 'same reference must not apply twice');

  const noReason = await post(`/api/wallets/${walletId}/adjust`, { amount: 50, reason: '' }, A);
  assert.strictEqual(noReason.status, 400);

  const statement = await get(`/api/wallets/${walletId}/statement`, A);
  assert.strictEqual(statement.status, 200);
  assert.strictEqual(statement.body.wallet.isWithdrawable, false, 'plan money is never withdrawable');
  const recomputed = statement.body.transactions.reduce(
    (sum, t) => sum + (t.direction === 'CREDIT' ? t.amount : -t.amount), 0);
  assert.ok(near(recomputed, statement.body.balance), 'ledger must reconcile to the balance');
  assert.ok(near(statement.body.balance, balPreAdj - 100));
  console.log(`   🔒 Adjustment applied once; ${statement.body.transactions.length} ledger rows reconcile to ₹${statement.body.balance}`);

  // ---- 12. insufficient balance ----
  console.log('12. Testing a delivery cannot overdraw the wallet...');
  const drain = await get(`/api/subscriptions/${plan.id}`, A);
  await post(`/api/wallets/${walletId}/adjust`,
    { amount: -drain.body.walletBalance, reason: 'Drain for overdraft test', reference: `drain-${plan.id}` }, A);
  const drained = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(drained.body.walletBalance, 0));

  const nextAfterDrain = drained.body.deliveries.find((d) => d.status === 'PLANNED');
  const overdraw = await post(`/api/subscriptions/deliveries/${nextAfterDrain.id}/run`, {}, A);
  assert.strictEqual(overdraw.status, 400, JSON.stringify(overdraw.body));
  assert.strictEqual(overdraw.body.code, 'INSUFFICIENT_BALANCE');

  const afterOverdraw = await get(`/api/subscriptions/${plan.id}`, A);
  assert.ok(near(afterOverdraw.body.walletBalance, 0), 'balance never went negative');
  assert.strictEqual(
    afterOverdraw.body.deliveries.find((d) => d.id === nextAfterDrain.id).status, 'PLANNED',
    'a refused delivery is released back to PLANNED for retry');
  console.log('   🔒 Overdraw refused; delivery released back to PLANNED');

  // ---- 13. batch runner ----
  console.log('13. Testing the due-delivery batch runner is idempotent...');
  const refund = await post(`/api/wallets/${walletId}/adjust`,
    { amount: 5000, reason: 'Refund for batch test', reference: `refund-${plan.id}` }, A);
  assert.strictEqual(refund.status, 200);

  // The plan starts tomorrow, so run "as of" a week out to make several
  // deliveries genuinely due — otherwise this step proves nothing.
  const asOf = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const plannedBefore = (await get(`/api/subscriptions/${plan.id}`, A))
    .body.deliveries.filter((d) => d.status === 'PLANNED').length;

  const batch1 = await post('/api/subscriptions/run-due', { onDate: asOf }, A);
  assert.strictEqual(batch1.status, 200);
  assert.ok(batch1.body.generated > 0, `the batch must generate due deliveries (attempted ${batch1.body.attempted})`);

  const batch2 = await post('/api/subscriptions/run-due', { onDate: asOf }, A);
  assert.strictEqual(batch2.body.generated, 0, 'a second batch run generates nothing new');

  const plannedAfter = (await get(`/api/subscriptions/${plan.id}`, A))
    .body.deliveries.filter((d) => d.status === 'PLANNED').length;
  assert.strictEqual(plannedAfter, plannedBefore - batch1.body.generated,
    'exactly the generated count left PLANNED');

  const finalState = await get(`/api/subscriptions/${plan.id}`, A);
  // The invariant is one sub-order per delivery that was ever materialised — a
  // FAILED delivery keeps its (reversed) sub-order as the audit record.
  const materialised = finalState.body.deliveries.filter((d) => d.subOrderId);
  const allOrders = await get('/api/orders', A);
  const planOrders = allOrders.body.filter((o) => o.subscriptionId === plan.id);
  assert.strictEqual(planOrders.length, materialised.length,
    `one sub-order per materialised delivery (${planOrders.length} orders vs ${materialised.length} deliveries)`);
  const ids = new Set(planOrders.map((o) => o.subscriptionDeliveryId));
  assert.strictEqual(ids.size, planOrders.length, 'no delivery may have two sub-orders');
  console.log(`   🔒 Batch ran ${batch1.body.generated}; re-run generated 0; ${planOrders.length} orders = ${materialised.length} materialised deliveries, all distinct`);

  // ---- 14. cancellation stops everything ----
  console.log('14. Testing cancellation halts future deliveries...');
  await patch(`/api/subscriptions/${plan.id}/status`, { status: 'CANCELLED' }, A);
  const cancelled = await get(`/api/subscriptions/${plan.id}`, A);
  const stillPlanned = cancelled.body.deliveries.find((d) => d.status === 'PLANNED');
  if (stillPlanned) {
    const afterCancel = await post(`/api/subscriptions/deliveries/${stillPlanned.id}/run`, {}, A);
    assert.strictEqual(afterCancel.body.ran, false);
    assert.strictEqual(afterCancel.body.reason, 'SUBSCRIPTION_CANCELLED');
  }
  const reactivate = await patch(`/api/subscriptions/${plan.id}/status`, { status: 'ACTIVE' }, A);
  assert.strictEqual(reactivate.status, 400, 'a cancelled plan cannot be reactivated');
  console.log('   🔒 Cancelled plan blocks deliveries and cannot be reactivated');

  // ---- 15. no withdrawal path ----
  console.log('15. Testing there is no withdrawal mechanism...');
  for (const path of [`/api/wallets/${walletId}/withdraw`, `/api/wallets/${walletId}/cashout`]) {
    const r = await post(path, { amount: 100 }, A);
    assert.ok(r.status === 404 || r.status === 405, `${path} must not exist (got ${r.status})`);
  }
  console.log('   🔒 No withdrawal or cash-out endpoint exists');

  console.log('\n🎉 SUBSCRIPTION & WALLET INTEGRITY TESTS PASSED! 🎉\n');
}

run().catch((err) => {
  console.error('\n❌ SUBSCRIPTION TESTS FAILED:', err.message);
  process.exit(1);
});
