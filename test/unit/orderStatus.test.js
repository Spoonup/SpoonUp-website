import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  canTransition, assertTransition, initialStatusFor, allStatusesFor, isTerminal
} = await import('../../server/orderStatus.js');

test('each type starts in its own initial state', () => {
  assert.equal(initialStatusFor('IMMEDIATE'), 'pending');
  assert.equal(initialStatusFor('DELIVERY_IN_DAYS'), 'pending');
  assert.equal(initialStatusFor('SCHEDULED'), 'scheduled');
  assert.equal(initialStatusFor('SUBSCRIPTION_DELIVERY'), 'scheduled');
});

test('immediate follows the kitchen path', () => {
  assert.ok(canTransition('IMMEDIATE', 'pending', 'preparing'));
  assert.ok(canTransition('IMMEDIATE', 'preparing', 'ready'));
  assert.ok(canTransition('IMMEDIATE', 'ready', 'out_for_delivery'));
  assert.ok(canTransition('IMMEDIATE', 'out_for_delivery', 'delivered'));
});

test('delivery-in-days follows the sourcing path', () => {
  assert.ok(canTransition('DELIVERY_IN_DAYS', 'pending', 'sourcing'));
  assert.ok(canTransition('DELIVERY_IN_DAYS', 'sourcing', 'packed'));
  assert.ok(canTransition('DELIVERY_IN_DAYS', 'packed', 'shipped'));
  assert.ok(canTransition('DELIVERY_IN_DAYS', 'shipped', 'delivered'));
});

test('workflows do not bleed across types', () => {
  // "sourcing" is unreachable for a kitchen item…
  assert.equal(canTransition('IMMEDIATE', 'pending', 'sourcing'), false);
  // …and a sourced item never goes through the kitchen.
  assert.equal(canTransition('DELIVERY_IN_DAYS', 'pending', 'preparing'), false);
});

test('backward and skipping transitions are refused', () => {
  assert.equal(canTransition('IMMEDIATE', 'delivered', 'preparing'), false);
  assert.equal(canTransition('IMMEDIATE', 'pending', 'delivered'), false);
  assert.equal(canTransition('DELIVERY_IN_DAYS', 'pending', 'shipped'), false);
});

test('terminal states have no exits', () => {
  for (const s of ['delivered', 'cancelled', 'refunded']) {
    assert.ok(isTerminal(s));
    assert.equal(canTransition('IMMEDIATE', s, 'preparing'), false);
  }
});

test('a failed delivery can be retried but a subscription delivery cannot be cancelled', () => {
  assert.ok(canTransition('IMMEDIATE', 'failed_delivery', 'out_for_delivery'));
  // Cancelling would leave the wallet debit without a matching reversal.
  assert.equal(canTransition('SUBSCRIPTION_DELIVERY', 'scheduled', 'cancelled'), false);
  assert.ok(canTransition('SUBSCRIPTION_DELIVERY', 'scheduled', 'skipped'));
  assert.ok(canTransition('SUBSCRIPTION_DELIVERY', 'failed_delivery', 'reversed'));
});

test('assertTransition throws with a usable code', () => {
  assert.throws(() => assertTransition('IMMEDIATE', 'pending', 'shipped'),
    (e) => e.code === 'INVALID_STATUS_TRANSITION' && e.status === 400);
  assert.throws(() => assertTransition('IMMEDIATE', 'ready', 'ready'),
    (e) => e.code === 'STATUS_UNCHANGED');
  assert.doesNotThrow(() => assertTransition('IMMEDIATE', 'pending', 'preparing'));
});

test('legacy orders without a sub-order type keep the flat vocabulary', () => {
  // Pre-migration rows transition exactly as they did before.
  assert.ok(canTransition('immediate', 'pending', 'preparing'));
  assert.ok(canTransition('immediate', 'ready', 'completed'));
  assert.ok(canTransition('delivery', 'pending', 'shipped'));
  assert.ok(canTransition('delivery', 'shipped', 'delivered'));
  assert.equal(canTransition('delivery', 'pending', 'sourcing'), false);
});

test('every type exposes its full vocabulary', () => {
  assert.ok(allStatusesFor('DELIVERY_IN_DAYS').includes('packed'));
  assert.equal(allStatusesFor('NOPE').length, 0);
});
