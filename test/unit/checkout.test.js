import { test } from 'node:test';
import assert from 'node:assert/strict';

// Keep unit tests hermetic: never pick up a real database from .env.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.ADMIN_PIN = process.env.ADMIN_PIN || 'unit-test-pin';
const {
  cleanPhoneNumber, isValidPhone, normalizeDeliveryAddress, splitVerifiedItems,
  cartNeedsDeliveryAddress, isCheckoutExpired, orderRefs, CHECKOUT_TTL_MS
} = await import('../../server/checkout.js');

test('cleanPhoneNumber strips everything but digits and plus', () => {
  assert.deepEqual(cleanPhoneNumber(' +91 98765-43210 '), { cleanPhone: '+919876543210', digitsOnly: '919876543210' });
  assert.equal(isValidPhone('+91 98765 43210'), true);
  assert.equal(isValidPhone('123'), false);
  assert.equal(isValidPhone('1'.repeat(19)), false);
});

test('normalizeDeliveryAddress enforces minimums and trims', () => {
  assert.equal(normalizeDeliveryAddress(null), null);
  assert.equal(normalizeDeliveryAddress({ line1: 'abc', city: 'x', pincode: '1' }), null);
  const ok = normalizeDeliveryAddress({ line1: '  12 Main Road ', city: 'Pune', pincode: '411001', state: 'MH' });
  assert.deepEqual(ok, { line1: '12 Main Road', line2: '', city: 'Pune', state: 'MH', pincode: '411001', landmark: '' });
  const long = normalizeDeliveryAddress({ line1: 'x'.repeat(500), city: 'Pune', pincode: '411001' });
  assert.equal(long.line1.length, 120);
});

test('splitVerifiedItems and cartNeedsDeliveryAddress', () => {
  const items = [{ id: 'a', deliverLater: false }, { id: 'b', deliverLater: true }];
  const { immediateItems, deliveryItems } = splitVerifiedItems(items);
  assert.deepEqual(immediateItems.map(i => i.id), ['a']);
  assert.deepEqual(deliveryItems.map(i => i.id), ['b']);
  assert.equal(cartNeedsDeliveryAddress(items), true);
  assert.equal(cartNeedsDeliveryAddress([items[0]]), false);
});

test('isCheckoutExpired only applies to open checkouts past the TTL', () => {
  const old = new Date(Date.now() - CHECKOUT_TTL_MS - 1000).toISOString();
  assert.equal(isCheckoutExpired({ status: 'open', createdAt: old }), true);
  assert.equal(isCheckoutExpired({ status: 'paid', createdAt: old }), false);
  assert.equal(isCheckoutExpired({ status: 'open', createdAt: new Date().toISOString() }), false);
  assert.equal(isCheckoutExpired(null), false);
});

test('orderRefs keeps only id and fulfilment type', () => {
  assert.deepEqual(
    orderRefs([{ id: 'ord-1', fulfillmentType: 'delivery', accessToken: 'secret' }, { id: 'ord-2' }]),
    [{ id: 'ord-1', fulfillmentType: 'delivery' }, { id: 'ord-2', fulfillmentType: 'immediate' }]
  );
});
