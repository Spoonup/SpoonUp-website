import crypto from 'crypto';
import {
  dbClaimSubscriptionDelivery,
  dbCreateOrder,
  dbCreateOrderItems,
  dbGetDueSubscriptionDeliveries,
  dbGetOrderById,
  dbGetProducts,
  dbGetSettings,
  dbGetSubscriptionById,
  dbGetSubscriptionDeliveries,
  dbGetSubscriptionDeliveryById,
  dbGetParentOrderById,
  dbUpdateOrder,
  dbUpdateSubscription,
  dbUpdateSubscriptionDelivery,
  generateOrderAccessToken
} from './db.js';
import { debitDelivery, reverseDelivery, getBalance } from './wallet.js';
import { calculateLineTax } from './tax.js';

/**
 * Turns planned subscription deliveries into real sub-orders.
 *
 * Ordering matters and is deliberate:
 *   1. claim the delivery   — conditional UPDATE, only one caller wins
 *   2. debit the wallet     — idempotency-keyed, so a retry is a no-op
 *   3. create the sub-order — linked back to both
 *
 * Claiming first means a concurrent second call finds nothing to claim and stops
 * before touching money. Debiting before creating means a crash between 2 and 3
 * leaves a debited-but-unfulfilled delivery, which `recoverDelivery` repairs —
 * the opposite order would hand out free food instead.
 *
 * Overdraft is structurally impossible on the happy path: amountDue is fixed at
 * plan creation and amountDue × deliveryCount equals the upfront credit, while
 * each delivery can debit at most once. The balance check in postTransaction
 * covers the remaining case — an admin adjustment or refund that lowers the
 * balance mid-plan.
 */

function domainError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

const CLAIMABLE = ['PLANNED'];

/** Runs one delivery. Safe to call repeatedly; only the first call has effect. */
export async function runSubscriptionDelivery(deliveryId, { force = false } = {}) {
  const delivery = await dbGetSubscriptionDeliveryById(deliveryId);
  if (!delivery) throw domainError('Delivery not found.', 404, 'DELIVERY_NOT_FOUND');

  const subscription = await dbGetSubscriptionById(delivery.subscriptionId);
  if (!subscription) throw domainError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');

  if (subscription.status === 'CANCELLED') {
    return { ran: false, reason: 'SUBSCRIPTION_CANCELLED', delivery };
  }
  if (subscription.status === 'PAUSED' && !force) {
    return { ran: false, reason: 'SUBSCRIPTION_PAUSED', delivery };
  }
  if (subscription.status === 'PENDING_PAYMENT') {
    return { ran: false, reason: 'SUBSCRIPTION_UNPAID', delivery };
  }

  // 1. Claim. A second caller gets null and stops here.
  const claimed = await dbClaimSubscriptionDelivery(deliveryId, CLAIMABLE, 'GENERATED');
  if (!claimed) {
    const latest = await dbGetSubscriptionDeliveryById(deliveryId);
    return { ran: false, reason: 'ALREADY_PROCESSED', delivery: latest, status: latest?.status };
  }

  try {
    // 2. Debit. Keyed on the delivery, so a retry after a partial failure
    //    reuses the original row rather than charging twice.
    const { transaction, duplicate } = await debitDelivery({
      walletId: subscription.walletId,
      subscriptionId: subscription.id,
      deliveryId,
      subOrderId: null,
      amount: delivery.amountDue
    });

    // 3. Materialise the sub-order.
    const subOrder = await createDeliverySubOrder({ subscription, delivery });

    await dbUpdateSubscriptionDelivery(deliveryId, {
      status: 'GENERATED',
      subOrderId: subOrder.id,
      walletTransactionId: transaction.id
    });

    await maybeCompleteSubscription(subscription.id);

    return { ran: true, delivery: { ...claimed, subOrderId: subOrder.id }, subOrder, transaction, duplicateDebit: duplicate };
  } catch (err) {
    // Put the delivery back so it can be retried, and release any money taken.
    await dbClaimSubscriptionDelivery(deliveryId, ['GENERATED'], 'PLANNED').catch(() => {});
    if (err.code !== 'INSUFFICIENT_BALANCE') {
      await reverseDelivery({
        walletId: subscription.walletId,
        subscriptionId: subscription.id,
        deliveryId,
        amount: delivery.amountDue,
        reason: `Rolled back: ${err.message}`.slice(0, 200)
      }).catch(() => {});
    }
    throw err;
  }
}

async function createDeliverySubOrder({ subscription, delivery }) {
  const products = await dbGetProducts();
  const product = products.find((p) => p.id === subscription.productId);
  const settings = await dbGetSettings();
  // Customer identity lives on the parent order that bought the plan.
  const parent = subscription.parentOrderId
    ? await dbGetParentOrderById(subscription.parentOrderId)
    : null;
  const now = new Date().toISOString();

  const name = product?.name || 'Subscription delivery';
  // The plan's price is locked at purchase; the live product price is ignored on
  // purpose, so a menu change never restates a paid plan.
  const tax = calculateLineTax(subscription.unitPrice, 1, subscription.gstRate);
  const subOrderId = `ord-${crypto.randomUUID()}`;

  const created = await dbCreateOrder({
    id: subOrderId,
    parentOrderId: subscription.parentOrderId,
    subOrderType: 'SUBSCRIPTION_DELIVERY',
    scheduledFor: `${delivery.scheduledDate}T00:00:00.000Z`,
    expectedShipDate: null,
    subscriptionId: subscription.id,
    subscriptionDeliveryId: delivery.id,
    customerName: parent?.customerName || 'Subscriber',
    customerPhone: parent?.customerPhone || '',
    items: [
      {
        id: subscription.productId,
        name,
        price: subscription.unitPrice,
        quantity: 1,
        category: product?.category || '',
        imageUrl: product?.imageUrl || '',
        deliverLater: false,
        gstRate: tax.taxRate,
        baseAmount: tax.baseAmount,
        taxAmount: tax.taxAmount,
        subtotal: tax.totalAmount
      }
    ],
    subtotalAmount: tax.baseAmount,
    taxAmount: tax.taxAmount,
    totalAmount: delivery.amountDue,
    status: 'scheduled',
    notes: `Plan ${subscription.id} · delivery ${delivery.sequenceNo} of ${subscription.deliveryCount}`,
    counterName: settings.counterName || 'Main Shop',
    userId: subscription.userId || null,
    fulfillmentType: 'immediate',
    paymentGroupId: `sub-${subscription.id}`,
    // Already funded from the wallet — never collected again at the door.
    paymentMethod: 'counter',
    paymentStatus: 'paid',
    razorpayOrderId: '',
    razorpayPaymentId: '',
    deliveryAddress: null,
    trackingLink: '',
    accessToken: generateOrderAccessToken(),
    createdAt: now,
    updatedAt: now
  });

  await dbCreateOrderItems([
    {
      id: `oit-${crypto.randomUUID()}`,
      subOrderId: created.id,
      productId: subscription.productId,
      productName: name,
      unitPrice: subscription.unitPrice,
      gstRate: tax.taxRate,
      quantity: 1,
      baseAmount: tax.baseAmount,
      taxAmount: tax.taxAmount,
      lineTotal: delivery.amountDue
    }
  ]);

  return created;
}

/** Every planned delivery whose date has arrived, across all active plans. */
export async function runDueDeliveries({ onDate, limit = 200 } = {}) {
  const day = onDate || new Date().toISOString().slice(0, 10);
  const due = await dbGetDueSubscriptionDeliveries(day, limit);
  const results = { attempted: due.length, generated: 0, skipped: 0, failed: 0, details: [] };

  for (const delivery of due) {
    try {
      const out = await runSubscriptionDelivery(delivery.id);
      if (out.ran) results.generated += 1;
      else results.skipped += 1;
      results.details.push({ deliveryId: delivery.id, ran: out.ran, reason: out.reason || null });
    } catch (err) {
      results.failed += 1;
      results.details.push({ deliveryId: delivery.id, ran: false, error: err.code || err.message });
    }
  }
  return results;
}

/**
 * Marks a generated delivery as failed and returns the money to the plan wallet,
 * so the customer keeps the entitlement they paid for.
 */
export async function failDelivery(deliveryId, reason = '') {
  const delivery = await dbGetSubscriptionDeliveryById(deliveryId);
  if (!delivery) throw domainError('Delivery not found.', 404, 'DELIVERY_NOT_FOUND');
  const subscription = await dbGetSubscriptionById(delivery.subscriptionId);
  if (!subscription) throw domainError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');

  const claimed = await dbClaimSubscriptionDelivery(deliveryId, ['GENERATED', 'FULFILLED'], 'FAILED');
  if (!claimed) {
    return { changed: false, reason: 'NOT_FAILABLE', status: delivery.status };
  }

  const { transaction, duplicate } = await reverseDelivery({
    walletId: subscription.walletId,
    subscriptionId: subscription.id,
    deliveryId,
    amount: delivery.amountDue,
    reason: reason || 'Delivery failed'
  });

  if (delivery.subOrderId) {
    const order = await dbGetOrderById(delivery.subOrderId);
    if (order && order.status !== 'reversed') {
      await dbUpdateOrder(delivery.subOrderId, { status: 'reversed' });
    }
  }
  return { changed: true, transaction, duplicateReversal: duplicate };
}

/** A skipped delivery is never debited, so nothing needs reversing. */
export async function skipDelivery(deliveryId) {
  const claimed = await dbClaimSubscriptionDelivery(deliveryId, CLAIMABLE, 'SKIPPED');
  if (!claimed) {
    const latest = await dbGetSubscriptionDeliveryById(deliveryId);
    return { changed: false, reason: 'ONLY_PLANNED_CAN_BE_SKIPPED', status: latest?.status };
  }
  return { changed: true, delivery: claimed };
}

export async function setSubscriptionStatus(subscriptionId, status) {
  const allowed = ['ACTIVE', 'PAUSED', 'CANCELLED'];
  if (!allowed.includes(status)) {
    throw domainError(`Status must be one of: ${allowed.join(', ')}`, 400, 'INVALID_SUBSCRIPTION_STATUS');
  }
  const subscription = await dbGetSubscriptionById(subscriptionId);
  if (!subscription) throw domainError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
  if (subscription.status === 'CANCELLED') {
    throw domainError('This plan is already cancelled.', 400, 'SUBSCRIPTION_CANCELLED');
  }
  return dbUpdateSubscription(subscriptionId, { status });
}

/** Closes a plan once no planned deliveries remain. */
async function maybeCompleteSubscription(subscriptionId) {
  const deliveries = await dbGetSubscriptionDeliveries(subscriptionId);
  const outstanding = deliveries.filter((d) => d.status === 'PLANNED');
  if (outstanding.length === 0) {
    await dbUpdateSubscription(subscriptionId, { status: 'COMPLETED' });
  }
}

/** Plan view with its schedule and derived wallet balance. */
export async function getSubscriptionDetail(subscriptionId) {
  const subscription = await dbGetSubscriptionById(subscriptionId);
  if (!subscription) throw domainError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
  const [deliveries, balance] = await Promise.all([
    dbGetSubscriptionDeliveries(subscriptionId),
    subscription.walletId ? getBalance(subscription.walletId) : 0
  ]);
  return { subscription, deliveries, walletBalance: balance };
}
