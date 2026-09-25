import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.LOCAL_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'spoonup-referrals-')), 'db.json'
);

const { dbCreateReferralRule, dbGetWalletsByUserId, dbGetWalletBalance } =
  await import('../../server/db.js');
const { getOrCreateCode, attachReferral, qualifyAndReward, activeRule, generateCode, referralSummary } =
  await import('../../server/referrals.js');

const balanceOf = async (userId) => {
  const wallets = await dbGetWalletsByUserId(userId);
  const spendable = wallets.find((w) => w.kind === 'SPENDABLE');
  return spendable ? dbGetWalletBalance(spendable.id) : 0;
};

test('a code is stable per user and unique in shape', async () => {
  const first = await getOrCreateCode('user-a', 'ananya');
  const again = await getOrCreateCode('user-a', 'ananya');
  assert.equal(first.code, again.code, 'a user keeps one code');
  assert.match(first.code, /^[A-Z0-9]+$/);
  assert.notEqual(generateCode('x'), generateCode('x'), 'the random tail differs');
});

test('self-referral is refused', async () => {
  const code = await getOrCreateCode('user-self', 'selfy');
  await assert.rejects(
    () => attachReferral({ code: code.code, referredUserId: 'user-self' }),
    (e) => e.code === 'SELF_REFERRAL'
  );
});

test('an unknown code is ignored rather than blocking signup', async () => {
  assert.equal(await attachReferral({ code: 'NOSUCHCODE', referredUserId: 'user-x' }), null);
  assert.equal(await attachReferral({ code: '', referredUserId: 'user-x' }), null);
});

test('a person can only ever be referred once', async () => {
  const a = await getOrCreateCode('ref-a', 'alpha');
  const b = await getOrCreateCode('ref-b', 'bravo');
  const first = await attachReferral({ code: a.code, referredUserId: 'newbie-1' });
  assert.equal(first.status, 'PENDING');
  await assert.rejects(
    () => attachReferral({ code: b.code, referredUserId: 'newbie-1' }),
    (e) => e.code === 'ALREADY_REFERRED'
  );
});

test('qualifying pays both sides exactly once', async () => {
  await dbCreateReferralRule({
    id: 'rule-test-1', referrerAmount: 150, referredAmount: 100,
    qualifyingEvent: 'FIRST_ORDER_PAID', minOrderAmount: 0,
    effectiveFrom: new Date(Date.now() - 1000).toISOString(), effectiveTo: null, isActive: true
  });

  const owner = await getOrCreateCode('payer-ref', 'payer');
  await attachReferral({ code: owner.code, referredUserId: 'payer-new' });

  const result = await qualifyAndReward({ referredUserId: 'payer-new', parentOrderId: 'par-1', orderAmount: 500 });
  assert.equal(result.rewarded, true);
  assert.equal(result.referral.status, 'REWARDED');
  assert.equal(await balanceOf('payer-ref'), 150);
  assert.equal(await balanceOf('payer-new'), 100);

  // Rule is snapshotted so a later change cannot restate this payout.
  assert.equal(result.reward.ruleSnapshot.referrerAmount, 150);

  const again = await qualifyAndReward({ referredUserId: 'payer-new', orderAmount: 500 });
  assert.equal(again.rewarded, false);
  assert.equal(again.reason, 'ALREADY_REWARDED');
  assert.equal(await balanceOf('payer-ref'), 150, 'no second payout');
  assert.equal(await balanceOf('payer-new'), 100);
});

test('concurrent qualification pays once', async () => {
  const owner = await getOrCreateCode('race-ref', 'racer');
  await attachReferral({ code: owner.code, referredUserId: 'race-new' });
  const settled = await Promise.all(
    Array.from({ length: 6 }, () => qualifyAndReward({ referredUserId: 'race-new', orderAmount: 500 }))
  );
  assert.equal(settled.filter((r) => r.rewarded).length, 1, 'exactly one grant');
  assert.equal(await balanceOf('race-ref'), 150);
});

test('a below-threshold order does not qualify', async () => {
  await dbCreateReferralRule({
    id: 'rule-test-2', referrerAmount: 50, referredAmount: 50,
    qualifyingEvent: 'FIRST_ORDER_PAID', minOrderAmount: 1000,
    effectiveFrom: new Date().toISOString(), effectiveTo: null, isActive: true
  });
  const owner = await getOrCreateCode('min-ref', 'minny');
  await attachReferral({ code: owner.code, referredUserId: 'min-new' });
  const low = await qualifyAndReward({ referredUserId: 'min-new', orderAmount: 100 });
  assert.equal(low.rewarded, false);
  assert.equal(low.reason, 'BELOW_MIN_ORDER');
  assert.equal(await balanceOf('min-new'), 0);

  const high = await qualifyAndReward({ referredUserId: 'min-new', orderAmount: 2000 });
  assert.equal(high.rewarded, true);
});

test('someone with no referral simply does not qualify', async () => {
  const none = await qualifyAndReward({ referredUserId: 'stranger', orderAmount: 5000 });
  assert.equal(none.rewarded, false);
  assert.equal(none.reason, 'NO_REFERRAL');
});

test('bonus configuration is data: the newest live rule wins', async () => {
  const rule = await activeRule();
  assert.ok(rule.referrerAmount >= 0);
  await dbCreateReferralRule({
    id: 'rule-test-3', referrerAmount: 999, referredAmount: 1,
    qualifyingEvent: 'FIRST_ORDER_PAID', minOrderAmount: 0,
    effectiveFrom: new Date(Date.now() + 500).toISOString(), effectiveTo: null, isActive: true
  });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal((await activeRule()).referrerAmount, 999, 'no code change needed to alter the payout');
});

test('the summary reports progress without leaking other accounts', async () => {
  const s = await referralSummary('payer-ref');
  assert.equal(s.joined, 1);
  assert.equal(s.rewarded, 1);
  assert.ok(s.code);
  assert.ok(s.rule.referrerAmount >= 0);
  assert.ok(!JSON.stringify(s).includes('payer-new'), 'referred user ids are not exposed');
});
