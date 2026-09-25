import crypto from 'crypto';
import {
  dbClaimCouponRedemption,
  dbCountCouponRedemptions,
  dbCreateCoupon,
  dbGetCouponByCode,
  dbIsCouponCohortMember,
  dbReleaseCouponRedemption
} from './db.js';
import { roundMoney } from './tax.js';

/**
 * Coupons: GLOBAL, COHORT (a named list of users) and SINGLE_USER.
 *
 * Validation and redemption are deliberately separate:
 *   validate() is advisory — it tells the customer whether a code looks usable.
 *   redeem()   is authoritative — it INSERTs the redemption row first, and the
 *              unique (coupon_id, user_key) index decides the winner.
 *
 * That ordering is what makes concurrent checkouts safe. Two tabs both pass
 * validation; only one can insert. The loser is told the coupon is used rather
 * than silently getting a second discount.
 */

export const SCOPES = ['GLOBAL', 'COHORT', 'SINGLE_USER'];
export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'];

function bad(message, code) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().slice(0, 40);
}

/**
 * Guests have no user id, so the per-user key falls back to their phone. This
 * keeps "one per customer" meaningful without an account, while a signed-in
 * user is always keyed on their stable id.
 */
export function userKeyFor({ userId, phone }) {
  if (userId) return `u:${userId}`;
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Key on the last 10 digits so the same person cannot redeem twice by
  // entering their number with and without a country code (+919900003333 and
  // 9900003333 must resolve to one key). Shorter numbers are used as-is.
  return `p:${digits.length > 10 ? digits.slice(-10) : digits}`;
}

export function computeDiscount(coupon, subtotal) {
  const base = Number(subtotal) || 0;
  let discount =
    coupon.discountType === 'PERCENT'
      ? (base * Number(coupon.discountValue)) / 100
      : Number(coupon.discountValue);
  if (coupon.maxDiscountAmount != null) discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  // A coupon can never make an order negative or pay the customer.
  return roundMoney(Math.max(0, Math.min(discount, base)));
}

/**
 * Advisory check. Throws a domain error the customer can act on.
 * Does NOT reserve anything — redeem() does that.
 */
export async function validateCoupon({ code, subtotal, userId, phone, now = Date.now() }) {
  const coupon = await dbGetCouponByCode(normalizeCode(code));
  if (!coupon) throw bad('That coupon code is not valid.', 'COUPON_NOT_FOUND');
  if (!coupon.isActive) throw bad('That coupon is no longer active.', 'COUPON_INACTIVE');

  if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) {
    throw bad('That coupon is not active yet.', 'COUPON_NOT_STARTED');
  }
  if (coupon.validTo && new Date(coupon.validTo).getTime() < now) {
    throw bad('That coupon has expired.', 'COUPON_EXPIRED');
  }
  if (Number(subtotal) < Number(coupon.minOrderAmount || 0)) {
    throw bad(`This coupon needs a minimum order of ${coupon.minOrderAmount}.`, 'COUPON_MIN_ORDER');
  }

  const key = userKeyFor({ userId, phone });
  if (!key) throw bad('Sign in or add a phone number to use a coupon.', 'COUPON_NEEDS_IDENTITY');

  if (coupon.scope === 'SINGLE_USER' && coupon.singleUserId !== userId) {
    // Same message as a bad code: never confirm that someone else's coupon exists.
    throw bad('That coupon code is not valid.', 'COUPON_NOT_FOUND');
  }
  if (coupon.scope === 'COHORT') {
    const member = await dbIsCouponCohortMember(coupon.id, userId);
    if (!member) throw bad('That coupon code is not valid.', 'COUPON_NOT_FOUND');
  }

  if (coupon.totalUsageLimit != null) {
    const used = await dbCountCouponRedemptions(coupon.id);
    if (used >= coupon.totalUsageLimit) throw bad('That coupon has been fully claimed.', 'COUPON_EXHAUSTED');
  }

  return { coupon, userKey: key, discount: computeDiscount(coupon, subtotal) };
}

/**
 * Reserves the coupon for this user, then returns the discount.
 * The INSERT happens before any money is computed into an order, so a race can
 * only ever produce one redemption.
 */
export async function redeemCoupon({ code, subtotal, userId, phone, parentOrderId, now = Date.now() }) {
  const { coupon, userKey, discount } = await validateCoupon({ code, subtotal, userId, phone, now });

  const claim = await dbClaimCouponRedemption({
    id: `crd-${crypto.randomUUID()}`,
    couponId: coupon.id,
    userKey,
    parentOrderId: parentOrderId || null,
    discountApplied: discount,
    redeemedAt: new Date(now).toISOString()
  });

  if (!claim) {
    throw bad('You have already used this coupon.', 'COUPON_ALREADY_USED');
  }
  return { coupon, redemption: claim, discount };
}

/** Undoes a reservation when the order it was taken for could not be created. */
export async function releaseCoupon(redemptionId) {
  if (!redemptionId) return false;
  return dbReleaseCouponRedemption(redemptionId);
}

export async function createCoupon(input, createdByAdmin) {
  const code = normalizeCode(input.code);
  if (code.length < 3) throw bad('A coupon code needs at least 3 characters.', 'INVALID_COUPON');
  if (!SCOPES.includes(input.scope)) throw bad(`Scope must be one of: ${SCOPES.join(', ')}`, 'INVALID_COUPON');
  if (!DISCOUNT_TYPES.includes(input.discountType)) {
    throw bad(`Discount type must be one of: ${DISCOUNT_TYPES.join(', ')}`, 'INVALID_COUPON');
  }
  const value = Number(input.discountValue);
  if (!Number.isFinite(value) || value <= 0) throw bad('Discount value must be positive.', 'INVALID_COUPON');
  if (input.discountType === 'PERCENT' && value > 100) {
    throw bad('A percentage discount cannot exceed 100.', 'INVALID_COUPON');
  }
  if (input.scope === 'SINGLE_USER' && !input.singleUserId) {
    throw bad('A single-user coupon needs a user id.', 'INVALID_COUPON');
  }
  if (await dbGetCouponByCode(code)) throw bad('That coupon code already exists.', 'COUPON_EXISTS');

  return dbCreateCoupon({
    id: `cpn-${crypto.randomUUID()}`,
    code,
    description: String(input.description || '').slice(0, 200),
    scope: input.scope,
    singleUserId: input.scope === 'SINGLE_USER' ? input.singleUserId : null,
    discountType: input.discountType,
    discountValue: value,
    maxDiscountAmount: input.maxDiscountAmount == null ? null : Number(input.maxDiscountAmount),
    minOrderAmount: Number(input.minOrderAmount || 0),
    validFrom: input.validFrom || new Date().toISOString(),
    validTo: input.validTo || null,
    totalUsageLimit: input.totalUsageLimit == null ? null : Number(input.totalUsageLimit),
    perUserLimit: 1,
    isActive: input.isActive !== false,
    createdByAdmin: createdByAdmin || null,
    createdAt: new Date().toISOString()
  });
}
