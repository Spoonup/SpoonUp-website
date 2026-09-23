import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGstRate, roundMoney, calculateLineTax, DEFAULT_GST_RATE } from '../../server/tax.js';

test('normalizeGstRate clamps and defaults', () => {
  assert.equal(normalizeGstRate(undefined), DEFAULT_GST_RATE);
  assert.equal(normalizeGstRate('abc'), DEFAULT_GST_RATE);
  assert.equal(normalizeGstRate(-1), DEFAULT_GST_RATE);
  assert.equal(normalizeGstRate(101), DEFAULT_GST_RATE);
  assert.equal(normalizeGstRate(12.345), 12.35);
  assert.equal(normalizeGstRate(0), 0);
});

test('roundMoney rounds to paise without float drift', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney('12.345'), 12.35);
});

test('calculateLineTax splits base and tax', () => {
  const line = calculateLineTax(70, 3, 5);
  assert.deepEqual(line, { baseAmount: 210, taxRate: 5, taxAmount: 10.5, totalAmount: 220.5 });
  const zero = calculateLineTax(100, 1, 0);
  assert.equal(zero.taxAmount, 0);
  assert.equal(zero.totalAmount, 100);
});
