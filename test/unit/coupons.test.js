import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.LOCAL_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'spoonup-coupons-')), 'db.json'
);

const { dbAddCouponCohortMembers, dbCountCouponRedemptions } = await import('../../server/db.js');
const { createCoupon, validateCoupon, redeemCoupon, releaseCoupon, computeDiscount, userKeyFor } =
  await import('../../server/coupons.js');

let n = 0;
const uniq = (p) => `${p}${(n += 1)}`;

test('discount maths: percent, flat, cap, and never exceeding the order', () => {
  assert.equal(computeDiscount({ discountType: 'PERCENT', discountValue: 10 }, 1000), 100);
  assert.equal(computeDiscount({ discountType: 'FLAT', discountValue: 250 }, 1000), 250);
  assert.equal(computeDiscount({ discountType: 'PERCENT', discountValue: 50, maxDiscountAmount: 150 }, 1000), 150);
  assert.equal(computeDiscount({ discountType: 'FLAT', discountValue: 5000 }, 400), 400, 'cannot exceed the order');
  assert.equal(computeDiscount({ discountType: 'FLAT', discountValue: 5000 }, 0), 0, 'never negative');
});

test('a global coupon validates and redeems once per user', async () => {
  const code = uniq('GLOBAL');
  await createCoupon({ code, scope: 'GLOBAL', discountType: 'PERCENT', discountValue: 10 });
  const v = await validateCoupon({ code, subtotal: 1000, userId: 'u1' });
  assert.equal(v.discount, 100);

  const r = await redeemCoupon({ code, subtotal: 1000, userId: 'u1' });
  assert.equal(r.discount, 100);

  await assert.rejects(
    () => redeemCoupon({ code, subtotal: 1000, userId: 'u1' }),
    (e) => e.code === 'COUPON_ALREADY_USED'
  );
  // A different user is unaffected.
  const other = await redeemCoupon({ code, subtotal: 1000, userId: 'u2' });
  assert.equal(other.discount, 100);
});

test('concurrent redemptions by one user produce exactly one', async () => {
  const code = uniq('RACE');
  await createCoupon({ code, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 100 });
  const settled = await Promise.allSettled(
    Array.from({ length: 8 }, () => redeemCoupon({ code, subtotal: 500, userId: 'racer' }))
  );
  const won = settled.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1, `exactly one redemption may win, got ${won.length}`);
  assert.ok(settled.filter((r) => r.status === 'rejected')
    .every((r) => r.reason.code === 'COUPON_ALREADY_USED'));
});

test('a single-user coupon is invisible to everyone else', async () => {
  const code = uniq('MINE');
  await createCoupon({ code, scope: 'SINGLE_USER', singleUserId: 'owner', discountType: 'FLAT', discountValue: 100 });
  const ok = await validateCoupon({ code, subtotal: 500, userId: 'owner' });
  assert.equal(ok.discount, 100);
  await assert.rejects(
    () => validateCoupon({ code, subtotal: 500, userId: 'stranger' }),
    // Same error as an unknown code: never confirm someone else's coupon exists.
    (e) => e.code === 'COUPON_NOT_FOUND'
  );
});

test('a cohort coupon only works for listed members', async () => {
  const code = uniq('COHORT');
  const coupon = await createCoupon({ code, scope: 'COHORT', discountType: 'FLAT', discountValue: 50 });
  await dbAddCouponCohortMembers(coupon.id, ['member-a', 'member-b']);
  const ok = await validateCoupon({ code, subtotal: 500, userId: 'member-a' });
  assert.equal(ok.discount, 50);
  await assert.rejects(
    () => validateCoupon({ code, subtotal: 500, userId: 'outsider' }),
    (e) => e.code === 'COUPON_NOT_FOUND'
  );
});

test('validity window, activity and minimum order are enforced', async () => {
  const expired = uniq('EXPIRED');
  await createCoupon({ code: expired, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50,
    validTo: new Date(Date.now() - 86400000).toISOString() });
  await assert.rejects(() => validateCoupon({ code: expired, subtotal: 500, userId: 'u' }),
    (e) => e.code === 'COUPON_EXPIRED');

  const future = uniq('FUTURE');
  await createCoupon({ code: future, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50,
    validFrom: new Date(Date.now() + 86400000).toISOString() });
  await assert.rejects(() => validateCoupon({ code: future, subtotal: 500, userId: 'u' }),
    (e) => e.code === 'COUPON_NOT_STARTED');

  const inactive = uniq('OFF');
  await createCoupon({ code: inactive, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50, isActive: false });
  await assert.rejects(() => validateCoupon({ code: inactive, subtotal: 500, userId: 'u' }),
    (e) => e.code === 'COUPON_INACTIVE');

  const minOrder = uniq('MIN');
  await createCoupon({ code: minOrder, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50, minOrderAmount: 1000 });
  await assert.rejects(() => validateCoupon({ code: minOrder, subtotal: 500, userId: 'u' }),
    (e) => e.code === 'COUPON_MIN_ORDER');

  await assert.rejects(() => validateCoupon({ code: 'NOPE-NOT-REAL', subtotal: 500, userId: 'u' }),
    (e) => e.code === 'COUPON_NOT_FOUND');
});

test('a total usage limit closes the coupon for everyone', async () => {
  const code = uniq('LIMITED');
  const coupon = await createCoupon({ code, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50, totalUsageLimit: 2 });
  await redeemCoupon({ code, subtotal: 500, userId: 'a' });
  await redeemCoupon({ code, subtotal: 500, userId: 'b' });
  assert.equal(await dbCountCouponRedemptions(coupon.id), 2);
  await assert.rejects(() => redeemCoupon({ code, subtotal: 500, userId: 'c' }),
    (e) => e.code === 'COUPON_EXHAUSTED');
});

test('guests are keyed on phone so one-per-customer still means something', async () => {
  assert.equal(userKeyFor({ userId: 'u9' }), 'u:u9');
  assert.equal(userKeyFor({}), '');
  // The same number written different ways must resolve to ONE key, or a
  // customer redeems a single-use coupon twice by adding a country code.
  const forms = ['+91 98765 43210', '+919876543210', '9876543210', '098765 43210', '91-98765-43210'];
  const keys = new Set(forms.map((phone) => userKeyFor({ phone })));
  assert.equal(keys.size, 1, `all forms must key alike, got ${[...keys].join(', ')}`);
  assert.equal(userKeyFor({ phone: '9876543210' }), 'p:9876543210');

  const code = uniq('GUEST');
  await createCoupon({ code, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50 });
  await redeemCoupon({ code, subtotal: 500, phone: '9876500000' });
  for (const variant of ['98765 00000', '+919876500000', '+91 98765 00000', '919876500000']) {
    await assert.rejects(
      () => redeemCoupon({ code, subtotal: 500, phone: variant }),
      (e) => e.code === 'COUPON_ALREADY_USED',
      `${variant} must be recognised as the same customer`
    );
  }
  await assert.rejects(
    () => validateCoupon({ code, subtotal: 500 }),
    (e) => e.code === 'COUPON_NEEDS_IDENTITY'
  );
});

test('a released reservation frees the coupon again', async () => {
  const code = uniq('RELEASE');
  await createCoupon({ code, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 50 });
  const first = await redeemCoupon({ code, subtotal: 500, userId: 'rel' });
  await releaseCoupon(first.redemption.id);
  const second = await redeemCoupon({ code, subtotal: 500, userId: 'rel' });
  assert.equal(second.discount, 50, 'the order failed, so the coupon came back');
});

test('coupon creation validates its own inputs', async () => {
  await assert.rejects(() => createCoupon({ code: 'AB', scope: 'GLOBAL', discountType: 'FLAT', discountValue: 5 }),
    (e) => e.code === 'INVALID_COUPON');
  await assert.rejects(() => createCoupon({ code: uniq('X'), scope: 'NOPE', discountType: 'FLAT', discountValue: 5 }),
    (e) => e.code === 'INVALID_COUPON');
  await assert.rejects(() => createCoupon({ code: uniq('X'), scope: 'GLOBAL', discountType: 'PERCENT', discountValue: 150 }),
    (e) => e.code === 'INVALID_COUPON');
  await assert.rejects(() => createCoupon({ code: uniq('X'), scope: 'SINGLE_USER', discountType: 'FLAT', discountValue: 5 }),
    (e) => e.code === 'INVALID_COUPON');
  const dup = uniq('DUP');
  await createCoupon({ code: dup, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 5 });
  await assert.rejects(() => createCoupon({ code: dup, scope: 'GLOBAL', discountType: 'FLAT', discountValue: 5 }),
    (e) => e.code === 'COUPON_EXISTS');
});
