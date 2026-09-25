import crypto from 'crypto';
import {
  dbCreateOrder,
  dbCreateOrderItems,
  dbCreateParentOrder,
  dbCreateSubscription,
  dbCreateSubscriptionDeliveries,
  dbCreateWallet,
  dbGetSettings,
  generateOrderAccessToken
} from './db.js';
import { roundMoney } from './tax.js';
import { initialStatusFor } from './orderStatus.js';
import { buildDeliverySchedule } from './subscriptions.js';
import { creditSubscriptionFunding } from './wallet.js';

/**
 * Creates one parent order and its sub-orders from a validated cart.
 *
 * Subscription lines do NOT become sub-orders here. They create a plan, a
 * non-withdrawable PLAN wallet credited with the upfront amount, and a schedule
 * of planned deliveries. Each delivery materialises into a sub-order on its own
 * date, which is what keeps 30 future jars off the kitchen board today.
 *
 * Every write is keyed off `parentOrderId`, so a retried fulfilment with the
 * same id is a no-op rather than a duplicate: wallet writes carry an idempotency
 * key and the caller holds the checkout claim.
 */

function isoNow() {
  return new Date().toISOString();
}

/** Legacy column kept in sync so existing readers and queries keep working. */
function legacyFulfillmentType(subOrderType) {
  return subOrderType === 'DELIVERY_IN_DAYS' ? 'delivery' : 'immediate';
}

function itemSnapshot(line) {
  // Mirrors the historic orders.items JSONB shape so nothing downstream breaks.
  return {
    id: line.productId,
    name: line.name,
    price: line.unitPrice,
    quantity: line.quantity,
    category: line.category,
    imageUrl: line.imageUrl,
    deliverLater: Boolean(line.deliverLater),
    gstRate: line.gstRate,
    baseAmount: line.baseAmount,
    taxAmount: line.taxAmount,
    subtotal: line.lineTotal
  };
}

export async function createParentOrderWithSubOrders({
  cart,
  customerName,
  customerPhone,
  notes = '',
  userId = null,
  source = 'CUSTOMER',
  paymentMethod = 'counter',
  paymentStatus = 'unpaid',
  razorpayOrderId = '',
  razorpayPaymentId = '',
  deliveryAddress = null,
  negotiatedTotal = null,
  coupon = null,
  platform = 'WEB',
  createdByAdmin = null,
  parentOrderId
}) {
  const { parts, subscriptionIntents, totals, needsShippingAddress } = cart;

  if (needsShippingAddress && !deliveryAddress) {
    const err = new Error('Delivery address is required for deliver-later items.');
    err.status = 400;
    err.code = 'NEEDS_DELIVERY_ADDRESS';
    throw err;
  }

  const settings = await dbGetSettings();
  const now = isoNow();
  const parentId = parentOrderId || `par-${crypto.randomUUID()}`;
  // Subscription and wallet ids are derived from the parent, so re-running this
  // for the same parent can only ever produce the same subscription id — and
  // therefore the same `topup:<id>` idempotency key. Funding is then structurally
  // once-only, not merely protected by the checkout lock.
  const derivedId = (prefix, index) => `${prefix}-${parentId.slice(4)}-${index}`;
  // Order-level money lives on the parent: a coupon applies to the basket, not
  // to one part of it. Sub-order totals stay the sum of their own items.
  const couponDiscount = roundMoney(coupon?.discount || 0);
  const calculatedTotal = roundMoney(Math.max(0, totals.calculatedTotal - couponDiscount));
  const platformAdjustment = roundMoney(
    (cart.lines || []).reduce((sum, l) => sum + (l.platformAdjustment || 0) * (l.quantity || 1), 0)
  );
  const payableTotal =
    negotiatedTotal == null ? calculatedTotal : roundMoney(Math.min(negotiatedTotal, calculatedTotal));

  const parent = await dbCreateParentOrder({
    id: parentId,
    userId,
    customerName,
    customerPhone,
    platform,
    source,
    itemsSubtotal: totals.itemsSubtotal,
    taxTotal: totals.taxTotal,
    calculatedTotal,
    couponId: coupon?.couponId || null,
    couponCode: coupon?.code || null,
    couponDiscount,
    platformAdjustment,
    negotiatedTotal: negotiatedTotal == null ? null : roundMoney(negotiatedTotal),
    negotiatedDiscount:
      negotiatedTotal == null ? 0 : roundMoney(Math.max(0, calculatedTotal - negotiatedTotal)),
    payableTotal,
    paymentMethod,
    paymentStatus,
    razorpayOrderId,
    razorpayPaymentId,
    createdByAdmin,
    notes,
    createdAt: now,
    updatedAt: now
  });

  // ---- sub-orders, one per part ----
  const paymentGroupId = `pay-${parentId.slice(4)}`;
  const subOrders = [];
  const itemRows = [];

  for (const part of parts) {
    const paid = paymentStatus === 'paid';
    // A paid immediate order goes straight into prep; everything else starts at
    // its machine's initial state.
    let status = initialStatusFor(part.subOrderType);
    if (paid && part.subOrderType === 'IMMEDIATE') status = 'preparing';

    const subOrderId = `ord-${crypto.randomUUID()}`;
    const expectedShipDate =
      part.subOrderType === 'DELIVERY_IN_DAYS' && part.expectedShipDays
        ? new Date(Date.now() + part.expectedShipDays * 86400000).toISOString().slice(0, 10)
        : null;

    const created = await dbCreateOrder({
      id: subOrderId,
      parentOrderId: parentId,
      subOrderType: part.subOrderType,
      scheduledFor: part.scheduledFor,
      expectedShipDate,
      subscriptionId: null,
      subscriptionDeliveryId: null,
      customerName,
      customerPhone,
      items: part.lines.map(itemSnapshot),
      subtotalAmount: part.subtotalAmount,
      taxAmount: part.taxAmount,
      totalAmount: part.totalAmount,
      status,
      notes,
      counterName: settings.counterName || 'Main Shop',
      userId,
      fulfillmentType: legacyFulfillmentType(part.subOrderType),
      paymentGroupId,
      paymentMethod,
      paymentStatus,
      razorpayOrderId,
      razorpayPaymentId,
      deliveryAddress: part.subOrderType === 'DELIVERY_IN_DAYS' ? deliveryAddress : null,
      trackingLink: '',
      accessToken: generateOrderAccessToken(),
      createdAt: now,
      updatedAt: now
    });
    subOrders.push(created);

    for (const line of part.lines) {
      itemRows.push({
        id: `oit-${crypto.randomUUID()}`,
        subOrderId: created.id,
        productId: line.productId,
        productName: line.name,
        unitPrice: line.unitPrice,
        gstRate: line.gstRate,
        quantity: line.quantity,
        baseAmount: line.baseAmount,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal
      });
    }
  }

  if (itemRows.length) await dbCreateOrderItems(itemRows);

  // ---- subscriptions: plan + wallet + schedule ----
  const subscriptions = [];
  for (const [index, intent] of subscriptionIntents.entries()) {
    const q = intent.subscription;
    const subscriptionId = derivedId('sub', index);
    const walletId = derivedId('wal', index);

    await dbCreateWallet({
      id: walletId,
      userId,
      kind: 'PLAN',
      subscriptionId,
      isWithdrawable: false,
      status: 'ACTIVE',
      createdAt: now
    });

    const subscription = await dbCreateSubscription({
      id: subscriptionId,
      userId,
      productId: q.productId,
      parentOrderId: parentId,
      walletId,
      frequency: q.frequency,
      durationMonths: q.durationMonths,
      deliveryCount: q.deliveryCount,
      startDate: q.startDate,
      unitPrice: q.unitPrice,
      gstRate: q.gstRate,
      tierId: q.tierId,
      discountPercent: q.discountPercent,
      grossAmount: q.grossAmount,
      discountAmount: q.discountAmount,
      subtotalAmount: q.subtotalAmount,
      taxAmount: q.taxAmount,
      totalAmount: q.totalAmount,
      perDeliveryAmount: q.perDeliveryAmount,
      status: paymentStatus === 'paid' ? 'ACTIVE' : 'PENDING_PAYMENT',
      createdAt: now,
      updatedAt: now
    });

    // Upfront credit. Keyed on the subscription so a retry cannot double-credit.
    if (paymentStatus === 'paid') {
      await creditSubscriptionFunding({
        walletId,
        subscriptionId,
        amount: q.totalAmount,
        parentOrderId: parentId
      });
    }

    const schedule = buildDeliverySchedule({
      startDate: q.startDate,
      frequency: q.frequency,
      deliveryCount: q.deliveryCount
    });
    await dbCreateSubscriptionDeliveries(
      schedule.map((row) => ({
        id: `sdl-${subscriptionId.slice(4)}-${row.sequenceNo}`,
        subscriptionId,
        sequenceNo: row.sequenceNo,
        scheduledDate: row.scheduledDate,
        status: 'PLANNED',
        subOrderId: null,
        amountDue: q.perDeliveryAmount
      }))
    );

    subscriptions.push(subscription);
  }

  return { parent, subOrders, subscriptions };
}
