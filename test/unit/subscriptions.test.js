import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  deliveryCountFor, resolveTier, quoteSubscription, buildDeliverySchedule,
  isFrequency, isValidDurationMonths, DEFAULT_PRICING_TIERS
} = await import('../../server/subscriptions.js');

test('delivery count comes from frequency and duration', () => {
  assert.equal(deliveryCountFor('DAILY', 1), 30);
  assert.equal(deliveryCountFor('ALTERNATE_DAYS', 2), 30);
  assert.equal(deliveryCountFor('WEEKLY', 3), 12);
  assert.equal(deliveryCountFor('TWICE_WEEKLY', 1), 8);
  assert.equal(deliveryCountFor('NOPE', 1), 0);
});

test('discount is driven by order count, not duration', () => {
  // Same 30 deliveries over one month and over two: identical tier.
  const daily1m = quoteSubscription({ unitPrice: 300, gstRate: 5, frequency: 'DAILY', durationMonths: 1 });
  const alt2m = quoteSubscription({ unitPrice: 300, gstRate: 5, frequency: 'ALTERNATE_DAYS', durationMonths: 2 });
  assert.equal(daily1m.deliveryCount, alt2m.deliveryCount);
  assert.equal(daily1m.discountPercent, alt2m.discountPercent);
  assert.equal(daily1m.totalAmount, alt2m.totalAmount);
});

test('tiers resolve on inclusive boundaries and stay open-ended', () => {
  assert.equal(resolveTier(1).discountPercent, 0);
  assert.equal(resolveTier(11).discountPercent, 0);
  assert.equal(resolveTier(12).discountPercent, 8);
  assert.equal(resolveTier(29).discountPercent, 8);
  assert.equal(resolveTier(30).discountPercent, 14);
  assert.equal(resolveTier(60).discountPercent, 18);
  assert.equal(resolveTier(5000).discountPercent, 18);
});

test('tiers are data: a custom table changes pricing without touching the math', () => {
  const custom = [{ id: 'flat', minDeliveries: 1, maxDeliveries: null, discountPercent: 50 }];
  const q = quoteSubscription({ unitPrice: 100, gstRate: 0, frequency: 'DAILY', durationMonths: 1, tiers: custom });
  assert.equal(q.discountPercent, 50);
  assert.equal(q.subtotalAmount, 1500);   // 100 × 30 − 50%
});

test('quote arithmetic is internally consistent', () => {
  const q = quoteSubscription({ unitPrice: 300, gstRate: 5, frequency: 'DAILY', durationMonths: 1 });
  assert.equal(q.grossAmount, 9000);
  assert.equal(q.discountAmount, 1260);                       // 14%
  assert.equal(q.subtotalAmount, 7740);
  assert.equal(q.taxAmount, 387);                             // 5% of 7740
  assert.equal(q.totalAmount, 8127);
  assert.equal(q.subtotalAmount + q.taxAmount, q.totalAmount);
  assert.ok(Math.abs(q.perDeliveryAmount * q.deliveryCount - q.totalAmount) < 1);
});

test('the tier is snapshotted so later tier changes cannot restate a paid plan', () => {
  const q = quoteSubscription({ unitPrice: 300, gstRate: 5, frequency: 'DAILY', durationMonths: 1 });
  assert.equal(q.tierId, DEFAULT_PRICING_TIERS[2].id);
  assert.equal(typeof q.discountPercent, 'number');
});

test('invalid configuration throws a domain error', () => {
  assert.throws(() => quoteSubscription({ unitPrice: 300, gstRate: 5, frequency: 'NOPE', durationMonths: 1 }),
    (e) => e.code === 'INVALID_SUBSCRIPTION');
  assert.equal(isFrequency('DAILY'), true);
  assert.equal(isFrequency('HOURLY'), false);
  assert.equal(isValidDurationMonths(3), true);
  assert.equal(isValidDurationMonths(0), false);
  assert.equal(isValidDurationMonths(1.5), false);
});

test('the schedule spaces deliveries by frequency', () => {
  const daily = buildDeliverySchedule({ startDate: '2026-02-01', frequency: 'DAILY', deliveryCount: 3 });
  assert.deepEqual(daily.map((d) => d.scheduledDate), ['2026-02-01', '2026-02-02', '2026-02-03']);

  const alt = buildDeliverySchedule({ startDate: '2026-02-01', frequency: 'ALTERNATE_DAYS', deliveryCount: 3 });
  assert.deepEqual(alt.map((d) => d.scheduledDate), ['2026-02-01', '2026-02-03', '2026-02-05']);

  const weekly = buildDeliverySchedule({ startDate: '2026-02-01', frequency: 'WEEKLY', deliveryCount: 2 });
  assert.deepEqual(weekly.map((d) => d.scheduledDate), ['2026-02-01', '2026-02-08']);

  assert.equal(daily[0].sequenceNo, 1);
  assert.equal(buildDeliverySchedule({ startDate: 'bad', frequency: 'DAILY', deliveryCount: 3 }).length, 0);
});
