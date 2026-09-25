import crypto from 'crypto';
import {
  dbAppendWalletTransaction,
  dbGetWalletBalance,
  dbGetWalletById,
  dbGetWalletTransactions
} from './db.js';
import { roundMoney } from './tax.js';

/**
 * Wallet ledger.
 *
 * Every movement is an append-only row. Balance is always SUM(credits) −
 * SUM(debits) over the ledger — there is no mutable balance column to drift, and
 * nothing here ever UPDATEs or DELETEs a transaction. A correction is a new
 * compensating row, so the history stays auditable.
 *
 * Duplicate protection is the `idempotencyKey` unique index. Callers derive the
 * key from the thing being paid for (`delivery:<id>`, `topup:<subscriptionId>`),
 * so a retry writes nothing and returns the original row.
 *
 * There is deliberately NO withdrawal function. A PLAN wallet is funded upfront
 * and can only be spent on that plan's deliveries or reversed back into itself.
 */

export const TXN_TYPES = [
  'SUBSCRIPTION_TOPUP',
  'DELIVERY_DEBIT',
  'DELIVERY_REVERSAL',
  'REFERRAL_BONUS',
  'REFUND',
  'ADMIN_ADJUSTMENT',
  'EXPIRY'
];

const CREDIT_TYPES = new Set([
  'SUBSCRIPTION_TOPUP',
  'DELIVERY_REVERSAL',
  'REFERRAL_BONUS',
  'REFUND'
]);
const DEBIT_TYPES = new Set(['DELIVERY_DEBIT', 'EXPIRY']);

function domainError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function directionFor(type, signedAmount = 1) {
  if (CREDIT_TYPES.has(type)) return 'CREDIT';
  if (DEBIT_TYPES.has(type)) return 'DEBIT';
  // ADMIN_ADJUSTMENT can go either way; the sign of the amount decides.
  return signedAmount < 0 ? 'DEBIT' : 'CREDIT';
}

export async function getBalance(walletId) {
  return dbGetWalletBalance(walletId);
}

export async function getStatement(walletId) {
  const [wallet, transactions, balance] = await Promise.all([
    dbGetWalletById(walletId),
    dbGetWalletTransactions(walletId),
    dbGetWalletBalance(walletId)
  ]);
  if (!wallet) throw domainError('Wallet not found.', 404, 'WALLET_NOT_FOUND');
  return {
    wallet,
    balance,
    transactions: [...transactions].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    )
  };
}

/**
 * Writes one ledger row. Idempotent on `idempotencyKey`.
 * Returns `{ transaction, duplicate }` so callers can tell a fresh write from a
 * replay without treating the replay as a failure.
 */
export async function postTransaction({
  walletId,
  type,
  amount,
  reason = '',
  subscriptionId = null,
  subscriptionDeliveryId = null,
  subOrderId = null,
  parentOrderId = null,
  createdByAdmin = null,
  idempotencyKey,
  allowOverdraft = false
}) {
  if (!TXN_TYPES.includes(type)) {
    throw domainError(`Unknown wallet transaction type: ${type}`, 400, 'INVALID_TXN_TYPE');
  }
  if (!idempotencyKey) {
    throw domainError('A wallet transaction needs an idempotency key.', 500, 'MISSING_IDEMPOTENCY_KEY');
  }

  const signed = Number(amount);
  if (!Number.isFinite(signed) || signed === 0) {
    throw domainError('Wallet amount must be a non-zero number.', 400, 'INVALID_AMOUNT');
  }
  const direction = directionFor(type, signed);
  const magnitude = roundMoney(Math.abs(signed));

  const wallet = await dbGetWalletById(walletId);
  if (!wallet) throw domainError('Wallet not found.', 404, 'WALLET_NOT_FOUND');
  if (wallet.status !== 'ACTIVE') {
    throw domainError('This wallet is closed.', 400, 'WALLET_CLOSED');
  }

  // Balance check before the write. The ledger is the source of truth, so this
  // reads the derived balance rather than a cached column.
  if (direction === 'DEBIT' && !allowOverdraft) {
    const existing = await dbGetWalletTransactions(walletId);
    // A replay must not be blocked by its own earlier effect.
    const alreadyPosted = existing.find((t) => t.idempotencyKey === idempotencyKey);
    if (!alreadyPosted) {
      const balance = await dbGetWalletBalance(walletId);
      if (balance < magnitude) {
        throw domainError(
          `Insufficient wallet balance: ${balance} available, ${magnitude} required.`,
          400,
          'INSUFFICIENT_BALANCE'
        );
      }
    }
  }

  const row = {
    id: `wtx-${crypto.randomUUID()}`,
    walletId,
    direction,
    type,
    amount: magnitude,
    subscriptionId,
    subscriptionDeliveryId,
    subOrderId,
    parentOrderId,
    createdByAdmin,
    reason: String(reason || '').slice(0, 250),
    idempotencyKey,
    createdAt: new Date().toISOString()
  };

  const saved = await dbAppendWalletTransaction(row);
  return { transaction: saved, duplicate: saved.id !== row.id };
}

// ---- keyed helpers: the key is derived from the thing being paid for, so the
// ---- same real-world event can never post twice.

export const keys = {
  topup: (subscriptionId) => `topup:${subscriptionId}`,
  deliveryDebit: (deliveryId) => `delivery:${deliveryId}`,
  deliveryReversal: (deliveryId) => `reversal:${deliveryId}`,
  refund: (subscriptionId) => `refund:${subscriptionId}`,
  adjustment: (ref) => `adjust:${ref}`
};

export function creditSubscriptionFunding({ walletId, subscriptionId, amount, parentOrderId }) {
  return postTransaction({
    walletId,
    type: 'SUBSCRIPTION_TOPUP',
    amount,
    subscriptionId,
    parentOrderId,
    reason: 'Upfront plan payment',
    idempotencyKey: keys.topup(subscriptionId)
  });
}

export function debitDelivery({ walletId, subscriptionId, deliveryId, subOrderId, amount }) {
  return postTransaction({
    walletId,
    type: 'DELIVERY_DEBIT',
    amount,
    subscriptionId,
    subscriptionDeliveryId: deliveryId,
    subOrderId,
    reason: 'Scheduled delivery',
    idempotencyKey: keys.deliveryDebit(deliveryId)
  });
}

/** Compensating credit for a delivery that could not be fulfilled. */
export function reverseDelivery({ walletId, subscriptionId, deliveryId, amount, reason }) {
  return postTransaction({
    walletId,
    type: 'DELIVERY_REVERSAL',
    amount,
    subscriptionId,
    subscriptionDeliveryId: deliveryId,
    reason: reason || 'Delivery failed; entitlement returned',
    idempotencyKey: keys.deliveryReversal(deliveryId)
  });
}

/**
 * Manual correction. Always attributed, always reasoned, never silent.
 * Async so every failure path rejects — a synchronous throw here would escape a
 * caller that only attached .catch().
 */
export async function adjust({ walletId, amount, reason, reference, createdByAdmin, subscriptionId }) {
  if (!reason || String(reason).trim().length < 3) {
    throw domainError('An adjustment needs a reason.', 400, 'REASON_REQUIRED');
  }
  return postTransaction({
    walletId,
    type: 'ADMIN_ADJUSTMENT',
    amount,
    subscriptionId: subscriptionId || null,
    createdByAdmin,
    reason,
    idempotencyKey: keys.adjustment(reference || crypto.randomUUID())
  });
}
