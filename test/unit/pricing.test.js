import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { selectRule, applyRule, normalizePlatform, resolvePlatformPricing, PLATFORMS } =
  await import('../../server/pricing.js');

const NOW = Date.parse('2026-03-01T00:00:00Z');
const rule = (o) => ({ isActive: true, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, ...o });

const RULES = [
  rule({ id: 'g-ios', platform: 'IOS', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 20 }),
  rule({ id: 'c-ios', platform: 'IOS', scope: 'CATEGORY', scopeRef: 'Snacks', adjustmentType: 'PERCENT', adjustmentValue: 10 }),
  rule({ id: 'p-ios', platform: 'IOS', scope: 'PRODUCT', scopeRef: 'p1', adjustmentType: 'FLAT', adjustmentValue: 15 }),
  rule({ id: 'g-and', platform: 'ANDROID', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 5 }),
  rule({ id: 'expired', platform: 'WEB', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 50,
         effectiveTo: '2026-02-01T00:00:00Z' }),
  rule({ id: 'future', platform: 'WEB', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 50,
         effectiveFrom: '2027-01-01T00:00:00Z' }),
  rule({ id: 'off', platform: 'WEB', scope: 'GLOBAL', adjustmentType: 'PERCENT', adjustmentValue: 99, isActive: false })
];

test('an unknown platform falls back to WEB rather than erroring', () => {
  assert.equal(normalizePlatform('IOS'), 'IOS');
  assert.equal(normalizePlatform('ios'), 'IOS');
  assert.equal(normalizePlatform('WINDOWS_PHONE'), 'WEB');
  assert.equal(normalizePlatform(undefined), 'WEB');
  assert.deepEqual(PLATFORMS, ['WEB', 'ANDROID', 'IOS']);
});

test('rule precedence is product, then category, then global', () => {
  assert.equal(selectRule(RULES, { platform: 'IOS', productId: 'p1', category: 'Snacks' }, NOW).id, 'p-ios');
  assert.equal(selectRule(RULES, { platform: 'IOS', productId: 'p2', category: 'Snacks' }, NOW).id, 'c-ios');
  assert.equal(selectRule(RULES, { platform: 'IOS', productId: 'p2', category: 'Drinks' }, NOW).id, 'g-ios');
  assert.equal(selectRule(RULES, { platform: 'ANDROID', productId: 'p1', category: 'Snacks' }, NOW).id, 'g-and');
});

test('expired, future and inactive rules never apply', () => {
  assert.equal(selectRule(RULES, { platform: 'WEB', productId: 'p1', category: 'Snacks' }, NOW), null);
});

test('adjustments apply and never produce a negative price', () => {
  assert.equal(applyRule(100, null).price, 100);
  assert.equal(applyRule(100, RULES[0]).price, 120);            // +20%
  assert.equal(applyRule(100, RULES[2]).price, 115);            // +15 flat
  assert.equal(applyRule(100, RULES[2]).adjustment, 15);
  const wipeout = rule({ adjustmentType: 'FLAT', adjustmentValue: -9999 });
  assert.equal(applyRule(100, wipeout).price, 0, 'clamped at zero');
});

test('adjustments do not stack — exactly one rule per line', () => {
  // p1 on IOS matches product, category AND global; only the product rule counts.
  const r = selectRule(RULES, { platform: 'IOS', productId: 'p1', category: 'Snacks' }, NOW);
  assert.equal(applyRule(200, r).price, 215, 'flat +15 only, not +20% as well');
});

test('resolvePlatformPricing prices a catalogue per platform', async () => {
  const products = [
    { id: 'p1', price: 200, category: 'Snacks' },
    { id: 'p2', price: 100, category: 'Snacks' },
    { id: 'p3', price: 100, category: 'Drinks' }
  ];
  const ios = await resolvePlatformPricing(products, 'IOS', { rules: RULES, now: NOW });
  assert.equal(ios.get('p1').price, 215);
  assert.equal(ios.get('p2').price, 110);
  assert.equal(ios.get('p3').price, 120);

  const web = await resolvePlatformPricing(products, 'WEB', { rules: RULES, now: NOW });
  assert.equal(web.get('p1').price, 200, 'no live WEB rule leaves the base price');
  assert.equal(web.get('p1').adjustment, 0);

  const bogus = await resolvePlatformPricing(products, 'HACKED', { rules: RULES, now: NOW });
  assert.equal(bogus.get('p1').price, 200, 'a tampered platform degrades to WEB');
});
