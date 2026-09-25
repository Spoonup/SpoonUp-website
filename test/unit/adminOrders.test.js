import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { resolveNegotiation } = await import('../../server/adminOrders.js');

test('no negotiation leaves the calculated total payable', () => {
  for (const empty of [undefined, null, '']) {
    const r = resolveNegotiation(1000, empty);
    assert.equal(r.negotiatedTotal, null);
    assert.equal(r.negotiatedDiscount, 0);
    assert.equal(r.payableTotal, 1000);
  }
});

test('the discount is DERIVED, never supplied', () => {
  const r = resolveNegotiation(1000, 800);
  assert.equal(r.negotiatedTotal, 800);
  assert.equal(r.negotiatedDiscount, 200, '1000 − 800, computed by the server');
  assert.equal(r.payableTotal, 800);
  // The three always reconcile, by construction.
  assert.equal(r.negotiatedTotal + r.negotiatedDiscount, 1000);
});

test('a free order is allowed; a negative one is not', () => {
  const free = resolveNegotiation(1000, 0);
  assert.equal(free.payableTotal, 0);
  assert.equal(free.negotiatedDiscount, 1000);
  assert.throws(() => resolveNegotiation(1000, -1), (e) => e.code === 'INVALID_NEGOTIATED_PRICE');
});

test('an admin cannot negotiate a price ABOVE the calculated total', () => {
  assert.throws(() => resolveNegotiation(1000, 1200), (e) => e.code === 'NEGOTIATED_ABOVE_TOTAL');
  // Exactly equal is fine — that is simply no discount.
  const same = resolveNegotiation(1000, 1000);
  assert.equal(same.negotiatedDiscount, 0);
});

test('non-numeric input is refused rather than coerced', () => {
  for (const bad of ['abc', {}, [], NaN, Infinity]) {
    assert.throws(() => resolveNegotiation(1000, bad), (e) => e.code === 'INVALID_NEGOTIATED_PRICE');
  }
});

test('money is rounded to paise without float drift', () => {
  const r = resolveNegotiation(1000.555, 800.444);
  assert.equal(r.negotiatedTotal, 800.44);
  assert.equal(r.payableTotal, 800.44);
  assert.ok(Math.abs(r.negotiatedDiscount - 200.11) < 0.02);
});
