import { test } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never pick up a real database from .env.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { buildCart, groupIntoParts, validateScheduledFor, MAX_SCHEDULE_DAYS } =
  await import('../../server/cart.js');

const NOW = Date.parse('2026-01-10T10:00:00.000Z');
const inHours = (h) => new Date(NOW + h * 3600_000).toISOString();

const PRODUCTS = [
  { id: 'p-smoothie', name: 'Smoothie', price: 200, gstRate: 5, isAvailable: true,
    deliverLater: false, fulfillmentKind: 'IMMEDIATE', subscribable: false },
  { id: 'p-pudding', name: 'Pudding', price: 300, gstRate: 5, isAvailable: true,
    deliverLater: false, fulfillmentKind: 'IMMEDIATE', subscribable: true },
  { id: 'p-nuts', name: 'Dry Fruits', price: 900, gstRate: 5, isAvailable: true,
    deliverLater: true, fulfillmentKind: 'DELIVERY_IN_DAYS', leadTimeDays: 5, subscribable: false },
  { id: 'p-gone', name: 'Sold Out', price: 100, gstRate: 5, isAvailable: false,
    deliverLater: false, fulfillmentKind: 'IMMEDIATE', subscribable: false },
  { id: 'p-planonly', name: 'Plan Only', price: 250, gstRate: 5, isAvailable: true,
    deliverLater: false, fulfillmentKind: 'IMMEDIATE', subscribable: true, sellableOnce: false }
];

const build = (lines) => buildCart(lines, { now: NOW, products: PRODUCTS });

test('immediate line becomes one IMMEDIATE part with server-computed money', async () => {
  const cart = await build([{ id: 'p-smoothie', quantity: 2 }]);
  assert.equal(cart.parts.length, 1);
  assert.equal(cart.parts[0].subOrderType, 'IMMEDIATE');
  assert.equal(cart.parts[0].subtotalAmount, 400);
  assert.equal(cart.parts[0].taxAmount, 20);
  assert.equal(cart.totals.calculatedTotal, 420);
});

test('delivery-in-days line becomes DELIVERY_IN_DAYS and needs an address', async () => {
  const cart = await build([{ id: 'p-nuts', quantity: 1 }]);
  assert.equal(cart.parts[0].subOrderType, 'DELIVERY_IN_DAYS');
  assert.equal(cart.parts[0].expectedShipDays, 5);
  assert.equal(cart.needsShippingAddress, true);
});

test('a future slot on an immediate product produces SCHEDULED, not a subscription', async () => {
  const cart = await build([{ id: 'p-smoothie', quantity: 1, scheduledFor: inHours(5) }]);
  assert.equal(cart.parts[0].subOrderType, 'SCHEDULED');
  assert.equal(cart.parts[0].scheduledFor, inHours(5));
  assert.equal(cart.subscriptionIntents.length, 0);
});

test('subscription line creates a plan intent, never a sub-order part', async () => {
  const cart = await build([
    { id: 'p-pudding', purchaseMode: 'SUBSCRIPTION', frequency: 'ALTERNATE_DAYS', durationMonths: 2 }
  ]);
  assert.equal(cart.parts.length, 0);
  assert.equal(cart.subscriptionIntents.length, 1);
  const q = cart.subscriptionIntents[0].subscription;
  assert.equal(q.deliveryCount, 30);          // 60 days / every 2 days
  assert.equal(q.discountPercent, 14);        // 30 falls in the 30-59 tier
  assert.ok(q.totalAmount < 300 * 30);        // discounted
});

test('mixed cart splits into one part per type plus the plan', async () => {
  const cart = await build([
    { id: 'p-smoothie', quantity: 1 },
    { id: 'p-nuts', quantity: 1 },
    { id: 'p-smoothie', quantity: 1, scheduledFor: inHours(6) },
    { id: 'p-pudding', purchaseMode: 'SUBSCRIPTION', frequency: 'WEEKLY', durationMonths: 1 }
  ]);
  const types = cart.parts.map((p) => p.subOrderType).sort();
  assert.deepEqual(types, ['DELIVERY_IN_DAYS', 'IMMEDIATE', 'SCHEDULED']);
  assert.equal(cart.subscriptionIntents.length, 1);
});

test('two different slots become two separate SCHEDULED parts', async () => {
  const cart = await build([
    { id: 'p-smoothie', quantity: 1, scheduledFor: inHours(5) },
    { id: 'p-smoothie', quantity: 1, scheduledFor: inHours(9) }
  ]);
  assert.equal(cart.parts.filter((p) => p.subOrderType === 'SCHEDULED').length, 2);
});

test('invalid scheduling is rejected', async () => {
  await assert.rejects(
    () => build([{ id: 'p-smoothie', quantity: 1, scheduledFor: inHours(0.1) }]),
    (e) => e.code === 'SCHEDULE_TOO_SOON'
  );
  await assert.rejects(
    () => build([{ id: 'p-smoothie', quantity: 1, scheduledFor: inHours(24 * (MAX_SCHEDULE_DAYS + 2)) }]),
    (e) => e.code === 'SCHEDULE_TOO_FAR'
  );
  await assert.rejects(
    () => build([{ id: 'p-smoothie', quantity: 1, scheduledFor: 'not-a-date' }]),
    (e) => e.code === 'INVALID_SCHEDULE'
  );
  // A sourced product has no kitchen slot to book.
  await assert.rejects(
    () => build([{ id: 'p-nuts', quantity: 1, scheduledFor: inHours(5) }]),
    (e) => e.code === 'NOT_SCHEDULABLE'
  );
});

test('invalid subscription configuration is rejected', async () => {
  const base = { id: 'p-pudding', purchaseMode: 'SUBSCRIPTION' };
  await assert.rejects(() => build([{ ...base, frequency: 'HOURLY', durationMonths: 1 }]),
    (e) => e.code === 'INVALID_SUBSCRIPTION');
  await assert.rejects(() => build([{ ...base, frequency: 'DAILY', durationMonths: 99 }]),
    (e) => e.code === 'INVALID_SUBSCRIPTION');
  await assert.rejects(() => build([{ ...base, frequency: 'DAILY', durationMonths: 1, quantity: 3 }]),
    (e) => e.code === 'INVALID_SUBSCRIPTION');
  // A plan sets its own schedule.
  await assert.rejects(
    () => build([{ ...base, frequency: 'DAILY', durationMonths: 1, scheduledFor: inHours(5) }]),
    (e) => e.code === 'INVALID_SUBSCRIPTION'
  );
  await assert.rejects(
    () => build([{ id: 'p-smoothie', purchaseMode: 'SUBSCRIPTION', frequency: 'DAILY', durationMonths: 1 }]),
    (e) => e.code === 'NOT_SUBSCRIBABLE'
  );
});

test('availability and plan-only rules are enforced', async () => {
  await assert.rejects(() => build([{ id: 'p-gone', quantity: 1 }]), (e) => e.code === 'PRODUCT_SOLD_OUT');
  await assert.rejects(() => build([{ id: 'nope', quantity: 1 }]), (e) => e.code === 'PRODUCT_NOT_FOUND');
  await assert.rejects(() => build([{ id: 'p-planonly', quantity: 1 }]), (e) => e.code === 'PLAN_ONLY');
  await assert.rejects(() => build([]), (e) => e.code === 'EMPTY_CART');
});

test('quantities are clamped and client-supplied prices are ignored', async () => {
  const cart = await build([{ id: 'p-smoothie', quantity: 9999, price: 1, lineTotal: 1 }]);
  assert.equal(cart.lines[0].quantity, 50);
  assert.equal(cart.lines[0].unitPrice, 200);      // from the product, not the request
  assert.equal(cart.parts[0].subtotalAmount, 10000);
});

test('validateScheduledFor returns a normalised ISO string', () => {
  assert.equal(validateScheduledFor(inHours(4), NOW), inHours(4));
});

test('groupIntoParts is pure and keyed on type plus slot', () => {
  const { parts } = groupIntoParts([
    { purchaseMode: 'ONE_OFF', subOrderType: 'IMMEDIATE', scheduledFor: null, baseAmount: 10, taxAmount: 1, lineTotal: 11 },
    { purchaseMode: 'ONE_OFF', subOrderType: 'IMMEDIATE', scheduledFor: null, baseAmount: 20, taxAmount: 2, lineTotal: 22 }
  ]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].totalAmount, 33);
});
