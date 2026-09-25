import crypto from 'crypto';
import {
  dbCreateReferral,
  dbCreateReferralCode,
  dbCreateReferralReward,
  dbCreateWallet,
  dbGetReferralByReferredUserId,
  dbGetReferralCodeByCode,
  dbGetReferralCodeByUserId,
  dbGetReferralRules,
  dbGetReferralsByReferrer,
  dbGetWalletsByUserId,
  dbUpdateReferral
} from './db.js';
import { postTransaction } from './wallet.js';

/**
 * Referrals.
 *
 * Three guards, all at the storage layer rather than in a conditional:
 *   - CHECK (referrer <> referred)     → self-referral is unstorable
 *   - UNIQUE (referred_user_id)        → a person can be referred once, ever
 *   - UNIQUE (referral_id) on rewards  → a referral pays out once, ever
 *
 * Bonus amounts live in `referral_rules`, not here. Changing the payout is an
 * INSERT with a new effective_from; this file never changes. The rule in force
 * is snapshotted onto the reward so a later change cannot restate a past payout.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Used only when no rule row exists yet, so the system is never silently free.
export const FALLBACK_RULE = {
  id: 'rule-default',
  referrerAmount: 150,
  referredAmount: 150,
  qualifyingEvent: 'FIRST_ORDER_PAID',
  minOrderAmount: 0
};

function bad(message, code, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function generateCode(seed = '') {
  const base = String(seed).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'SPOON';
  let tail = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) tail += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${base}${tail}`;
}

/** The rule in force now. Most recently effective wins. */
export async function activeRule(now = Date.now()) {
  const rules = await dbGetReferralRules();
  const live = rules
    .filter((r) => {
      if (r.effectiveFrom && new Date(r.effectiveFrom).getTime() > now) return false;
      if (r.effectiveTo && new Date(r.effectiveTo).getTime() < now) return false;
      return true;
    })
    .sort((a, b) => new Date(b.effectiveFrom || 0) - new Date(a.effectiveFrom || 0));
  return live[0] || FALLBACK_RULE;
}

export async function getOrCreateCode(userId, username = '') {
  if (!userId) throw bad('A referral code needs a user.', 'REFERRAL_NEEDS_USER');
  const existing = await dbGetReferralCodeByUserId(userId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(username);
    if (await dbGetReferralCodeByCode(code)) continue;
    return dbCreateReferralCode({
      id: `rfc-${crypto.randomUUID()}`,
      userId,
      code,
      isActive: true,
      createdAt: new Date().toISOString()
    });
  }
  throw bad('Could not allocate a referral code.', 'REFERRAL_CODE_COLLISION', 500);
}

/**
 * Attaches a new signup to a referrer. Returns null when the code is unknown,
 * so a typo never blocks the signup itself.
 */
export async function attachReferral({ code, referredUserId }) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized || !referredUserId) return null;

  const owner = await dbGetReferralCodeByCode(normalized);
  if (!owner || owner.isActive === false) return null;

  if (owner.userId === referredUserId) {
    throw bad('You cannot refer yourself.', 'SELF_REFERRAL');
  }
  if (await dbGetReferralByReferredUserId(referredUserId)) {
    throw bad('This account has already been referred.', 'ALREADY_REFERRED');
  }

  // Unique(referred_user_id) makes this null on a concurrent duplicate.
  return dbCreateReferral({
    id: `rfr-${crypto.randomUUID()}`,
    referrerUserId: owner.userId,
    referredUserId,
    codeUsed: normalized,
    status: 'PENDING',
    signedUpAt: new Date().toISOString()
  });
}

async function spendableWalletFor(userId) {
  const wallets = await dbGetWalletsByUserId(userId);
  const found = wallets.find((w) => w.kind === 'SPENDABLE' && w.status === 'ACTIVE');
  if (found) return found;
  return dbCreateWallet({
    id: `wal-${crypto.randomUUID()}`,
    userId,
    kind: 'SPENDABLE',
    subscriptionId: null,
    isWithdrawable: false,
    status: 'ACTIVE',
    createdAt: new Date().toISOString()
  });
}

/**
 * Marks a referral qualified and pays both sides.
 * Idempotent twice over: the reward row is unique per referral, and each wallet
 * credit carries a derived idempotency key.
 */
export async function qualifyAndReward({ referredUserId, parentOrderId, orderAmount = 0, now = Date.now() }) {
  const referral = await dbGetReferralByReferredUserId(referredUserId);
  if (!referral) return { rewarded: false, reason: 'NO_REFERRAL' };
  if (referral.status === 'REWARDED') return { rewarded: false, reason: 'ALREADY_REWARDED', referral };
  if (referral.status === 'REJECTED') return { rewarded: false, reason: 'REJECTED', referral };

  const rule = await activeRule(now);
  if (Number(orderAmount) < Number(rule.minOrderAmount || 0)) {
    return { rewarded: false, reason: 'BELOW_MIN_ORDER', referral };
  }

  // Claim the reward row first: unique(referral_id) settles any race here,
  // before either wallet is touched.
  const reward = await dbCreateReferralReward({
    id: `rrw-${crypto.randomUUID()}`,
    referralId: referral.id,
    referrerTxnId: null,
    referredTxnId: null,
    amountReferrer: rule.referrerAmount,
    amountReferred: rule.referredAmount,
    ruleSnapshot: rule,
    createdAt: new Date(now).toISOString()
  });
  if (!reward) return { rewarded: false, reason: 'ALREADY_REWARDED', referral };

  const [referrerWallet, referredWallet] = await Promise.all([
    spendableWalletFor(referral.referrerUserId),
    spendableWalletFor(referral.referredUserId)
  ]);

  const credits = [];
  if (Number(rule.referrerAmount) > 0) {
    credits.push(
      postTransaction({
        walletId: referrerWallet.id,
        type: 'REFERRAL_BONUS',
        amount: rule.referrerAmount,
        reason: `Referral bonus for ${referral.referredUserId}`,
        idempotencyKey: `referral:${referral.id}:referrer`
      })
    );
  }
  if (Number(rule.referredAmount) > 0) {
    credits.push(
      postTransaction({
        walletId: referredWallet.id,
        type: 'REFERRAL_BONUS',
        amount: rule.referredAmount,
        reason: 'Welcome bonus',
        idempotencyKey: `referral:${referral.id}:referred`
      })
    );
  }
  const posted = await Promise.all(credits);

  const updated = await dbUpdateReferral(referral.id, {
    status: 'REWARDED',
    qualifyingParentOrderId: parentOrderId || null,
    qualifiedAt: new Date(now).toISOString()
  });

  return {
    rewarded: true,
    referral: updated,
    reward,
    transactions: posted.map((p) => p.transaction)
  };
}

export async function referralSummary(userId) {
  const [code, referrals] = await Promise.all([
    dbGetReferralCodeByUserId(userId),
    dbGetReferralsByReferrer(userId)
  ]);
  const rule = await activeRule();
  return {
    code: code?.code || null,
    rule: { referrerAmount: rule.referrerAmount, referredAmount: rule.referredAmount, qualifyingEvent: rule.qualifyingEvent },
    joined: referrals.length,
    rewarded: referrals.filter((r) => r.status === 'REWARDED').length,
    referrals: referrals.map((r) => ({ status: r.status, signedUpAt: r.signedUpAt }))
  };
}
