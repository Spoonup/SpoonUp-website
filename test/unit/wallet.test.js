import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Hermetic: a throwaway JSON database per run, never Supabase, never data/db.json.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.LOCAL_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'spoonup-wallet-')), 'db.json'
);

const { dbCreateWallet, dbGetWalletBalance, dbGetWalletTransactions } =
  await import('../../server/db.js');
const {
  postTransaction, creditSubscriptionFunding, debitDelivery, reverseDelivery,
  adjust, getStatement, directionFor, keys
} = await import('../../server/wallet.js');

let seq = 0;
async function makeWallet() {
  seq += 1;
  const id = `wal-test-${seq}`;
  await dbCreateWallet({
    id, userId: `usr-${seq}`, kind: 'PLAN', subscriptionId: `sub-${seq}`,
    isWithdrawable: false, status: 'ACTIVE', createdAt: new Date().toISOString()
  });
  return { walletId: id, subscriptionId: `sub-${seq}` };
}

test('a successful credit moves the derived balance', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  assert.equal(await dbGetWalletBalance(walletId), 0);
  const { transaction, duplicate } = await creditSubscriptionFunding({
    walletId, subscriptionId, amount: 8127, parentOrderId: 'par-1'
  });
  assert.equal(duplicate, false);
  assert.equal(transaction.direction, 'CREDIT');
  assert.equal(transaction.type, 'SUBSCRIPTION_TOPUP');
  assert.equal(await dbGetWalletBalance(walletId), 8127);
});

test('a duplicate credit is a no-op, not a second credit', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  const first = await creditSubscriptionFunding({ walletId, subscriptionId, amount: 5000 });
  const again = await creditSubscriptionFunding({ walletId, subscriptionId, amount: 5000 });
  assert.equal(again.duplicate, true);
  assert.equal(again.transaction.id, first.transaction.id, 'the original row is returned');
  assert.equal(await dbGetWalletBalance(walletId), 5000, 'balance credited exactly once');
  assert.equal((await dbGetWalletTransactions(walletId)).length, 1);
});

test('a successful debit reduces the balance', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 1000 });
  const { transaction } = await debitDelivery({
    walletId, subscriptionId, deliveryId: 'sdl-1', amount: 250
  });
  assert.equal(transaction.direction, 'DEBIT');
  assert.equal(transaction.subscriptionDeliveryId, 'sdl-1');
  assert.equal(await dbGetWalletBalance(walletId), 750);
});

test('a duplicate debit for the same delivery cannot double-charge', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 1000 });
  const first = await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-2', amount: 250 });
  const retry = await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-2', amount: 250 });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.transaction.id, first.transaction.id);
  assert.equal(await dbGetWalletBalance(walletId), 750, 'charged once despite two attempts');
});

test('a debit beyond the balance is refused', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 100 });
  await assert.rejects(
    () => debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-3', amount: 250 }),
    (e) => e.code === 'INSUFFICIENT_BALANCE'
  );
  assert.equal(await dbGetWalletBalance(walletId), 100, 'nothing was written');
  assert.equal((await dbGetWalletTransactions(walletId)).length, 1);
});

test('retrying a debit that already posted is not blocked by its own effect', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 250 });
  await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-4', amount: 250 });
  assert.equal(await dbGetWalletBalance(walletId), 0);
  // Balance is now 0, but the replay must still succeed as a no-op.
  const retry = await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-4', amount: 250 });
  assert.equal(retry.duplicate, true);
  assert.equal(await dbGetWalletBalance(walletId), 0);
});

test('concurrent debits for one delivery post exactly one row', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 1000 });
  const settled = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-race', amount: 100 })
    )
  );
  assert.ok(settled.every((r) => r.status === 'fulfilled'));
  const rows = (await dbGetWalletTransactions(walletId)).filter((t) => t.type === 'DELIVERY_DEBIT');
  assert.equal(rows.length, 1, 'idempotency key collapses the race to one row');
  assert.equal(await dbGetWalletBalance(walletId), 900);
});

test('a failed delivery is reversed, restoring the entitlement', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 1000 });
  await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-5', amount: 250 });
  assert.equal(await dbGetWalletBalance(walletId), 750);

  const rev = await reverseDelivery({ walletId, subscriptionId, deliveryId: 'sdl-5', amount: 250 });
  assert.equal(rev.transaction.direction, 'CREDIT');
  assert.equal(await dbGetWalletBalance(walletId), 1000);

  const again = await reverseDelivery({ walletId, subscriptionId, deliveryId: 'sdl-5', amount: 250 });
  assert.equal(again.duplicate, true);
  assert.equal(await dbGetWalletBalance(walletId), 1000, 'a reversal cannot be applied twice');
});

test('admin adjustments go both ways, are attributed, and need a reason', async () => {
  const { walletId } = await makeWallet();
  const up = await adjust({
    walletId, amount: 500, reason: 'Goodwill credit', reference: 'adj-1', createdByAdmin: 'admin-a'
  });
  assert.equal(up.transaction.direction, 'CREDIT');
  assert.equal(up.transaction.createdByAdmin, 'admin-a');
  assert.equal(await dbGetWalletBalance(walletId), 500);

  const down = await adjust({ walletId, amount: -200, reason: 'Correcting a mis-credit', reference: 'adj-2' });
  assert.equal(down.transaction.direction, 'DEBIT');
  assert.equal(await dbGetWalletBalance(walletId), 300);

  await assert.rejects(
    () => adjust({ walletId, amount: 10, reason: '', reference: 'adj-3' }),
    (e) => e.code === 'REASON_REQUIRED'
  );
  // Same reference replays rather than doubling.
  const replay = await adjust({ walletId, amount: 500, reason: 'Goodwill credit', reference: 'adj-1' });
  assert.equal(replay.duplicate, true);
  assert.equal(await dbGetWalletBalance(walletId), 300);
});

test('an over-debiting adjustment is refused like any other debit', async () => {
  const { walletId } = await makeWallet();
  await adjust({ walletId, amount: 100, reason: 'seed', reference: 'adj-seed' });
  await assert.rejects(
    () => adjust({ walletId, amount: -500, reason: 'too much', reference: 'adj-over' }),
    (e) => e.code === 'INSUFFICIENT_BALANCE'
  );
});

test('the statement is ordered and reconciles to the balance', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 900 });
  await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-6', amount: 300 });
  await reverseDelivery({ walletId, subscriptionId, deliveryId: 'sdl-6', amount: 300 });
  await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-7', amount: 300 });

  const st = await getStatement(walletId);
  assert.equal(st.wallet.isWithdrawable, false, 'plan money is never withdrawable');
  assert.equal(st.transactions.length, 4);
  const recomputed = st.transactions.reduce(
    (sum, t) => sum + (t.direction === 'CREDIT' ? t.amount : -t.amount), 0
  );
  assert.equal(recomputed, st.balance);
  assert.equal(st.balance, 600);
});

test('the ledger is append-only: nothing mutates an existing row', async () => {
  const { walletId, subscriptionId } = await makeWallet();
  await creditSubscriptionFunding({ walletId, subscriptionId, amount: 500 });
  const before = await dbGetWalletTransactions(walletId);
  await debitDelivery({ walletId, subscriptionId, deliveryId: 'sdl-8', amount: 100 });
  const after = await dbGetWalletTransactions(walletId);
  const original = after.find((t) => t.id === before[0].id);
  assert.deepEqual(original, before[0], 'the earlier row is untouched');
  assert.equal(after.length, before.length + 1, 'corrections are new rows, never edits');
});

test('guard rails on type, amount and key', async () => {
  const { walletId } = await makeWallet();
  await assert.rejects(
    () => postTransaction({ walletId, type: 'NOPE', amount: 1, idempotencyKey: 'k1' }),
    (e) => e.code === 'INVALID_TXN_TYPE'
  );
  await assert.rejects(
    () => postTransaction({ walletId, type: 'REFUND', amount: 0, idempotencyKey: 'k2' }),
    (e) => e.code === 'INVALID_AMOUNT'
  );
  await assert.rejects(
    () => postTransaction({ walletId, type: 'REFUND', amount: 5 }),
    (e) => e.code === 'MISSING_IDEMPOTENCY_KEY'
  );
  await assert.rejects(
    () => postTransaction({ walletId: 'nope', type: 'REFUND', amount: 5, idempotencyKey: 'k3' }),
    (e) => e.code === 'WALLET_NOT_FOUND'
  );
});

test('direction is derived from the type, and from the sign for adjustments', () => {
  assert.equal(directionFor('SUBSCRIPTION_TOPUP'), 'CREDIT');
  assert.equal(directionFor('DELIVERY_DEBIT'), 'DEBIT');
  assert.equal(directionFor('DELIVERY_REVERSAL'), 'CREDIT');
  assert.equal(directionFor('ADMIN_ADJUSTMENT', -5), 'DEBIT');
  assert.equal(directionFor('ADMIN_ADJUSTMENT', 5), 'CREDIT');
  assert.equal(keys.deliveryDebit('x'), 'delivery:x');
  assert.notEqual(keys.deliveryDebit('x'), keys.deliveryReversal('x'));
});

test('there is no withdrawal function exposed', async () => {
  const wallet = await import('../../server/wallet.js');
  const names = Object.keys(wallet).join(' ').toLowerCase();
  assert.ok(!names.includes('withdraw'), 'wallet must expose no withdrawal path');
  assert.ok(!names.includes('cashout'));
});
