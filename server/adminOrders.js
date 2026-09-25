import crypto from 'crypto';
import {
  dbGetOrders,
  dbGetOrderItemsBySubOrderIds,
  dbGetParentOrderById,
  dbGetSubscriptionsByUserId,
  dbGetSubscriptionDeliveries,
  dbGetWalletsByUserId,
  dbGetWalletTransactions,
  dbGetWalletBalance,
  dbGetPaymentByGatewayOrderId,
  dbGetUserById
} from './db.js';
import { roundMoney } from './tax.js';

/**
 * Admin-side reads and writes that the dashboard needs.
 *
 * Everything here is behind authenticateAdmin at the route layer; nothing in
 * this module assumes a role from the client.
 */

const MAX_HISTORY_ORDERS = 1000;

function domainError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Matches a customer by user id, or by the last 8 phone digits for guests. */
function matchesCustomer(order, { userId, phoneDigits }) {
  if (userId && order.userId === userId) return true;
  if (phoneDigits) {
    const d = String(order.customerPhone || '').replace(/\D/g, '');
    return d.length >= 8 && d.endsWith(phoneDigits);
  }
  return false;
}

/**
 * Complete historical record for one customer — every order ever placed, not
 * just open ones, with its money, payments, plans and wallet movements.
 */
export async function getCustomerHistory({ userId, phone }) {
  const phoneDigits = String(phone || '').replace(/\D/g, '').slice(-8);
  if (!userId && phoneDigits.length < 8) {
    throw domainError('Provide a user id or a phone number.', 400, 'CUSTOMER_KEY_REQUIRED');
  }

  const all = await dbGetOrders({ limit: MAX_HISTORY_ORDERS });
  const subOrders = all
    .filter((o) => matchesCustomer(o, { userId, phoneDigits }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const items = await dbGetOrderItemsBySubOrderIds(subOrders.map((o) => o.id));
  const itemsBySubOrder = items.reduce((acc, i) => {
    (acc[i.subOrderId] = acc[i.subOrderId] || []).push(i);
    return acc;
  }, {});

  // Group into the baskets they were bought in. Orders predating the parent
  // model fall back to their payment group, so history is never gappy.
  const groups = new Map();
  for (const so of subOrders) {
    const key = so.parentOrderId || so.paymentGroupId || so.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(so);
  }

  const orders = [];
  for (const [key, parts] of groups) {
    const head = parts[0];
    const parent = head.parentOrderId ? await dbGetParentOrderById(head.parentOrderId) : null;

    const partsTotal = roundMoney(parts.reduce((s, o) => s + Number(o.totalAmount || 0), 0));
    const payment = head.razorpayOrderId
      ? await dbGetPaymentByGatewayOrderId(head.razorpayOrderId).catch(() => null)
      : null;

    orders.push({
      key,
      parentOrderId: head.parentOrderId || null,
      legacy: !head.parentOrderId,
      placedAt: head.createdAt,
      customerName: head.customerName,
      customerPhone: head.customerPhone,
      platform: parent?.platform || null,
      source: parent?.source || 'CUSTOMER',
      money: {
        // Parent-level money exists only for orders created under the new model;
        // a legacy order's total is simply the sum of its parts.
        itemsSubtotal: parent ? Number(parent.itemsSubtotal) : partsTotal,
        taxTotal: parent ? Number(parent.taxTotal) : roundMoney(parts.reduce((s, o) => s + Number(o.taxAmount || 0), 0)),
        couponCode: parent?.couponCode || null,
        couponDiscount: Number(parent?.couponDiscount || 0),
        platformAdjustment: Number(parent?.platformAdjustment || 0),
        originalTotal: parent ? Number(parent.calculatedTotal) : partsTotal,
        negotiatedTotal: parent?.negotiatedTotal ?? null,
        negotiatedDiscount: Number(parent?.negotiatedDiscount || 0),
        finalAmount: parent ? Number(parent.payableTotal) : partsTotal
      },
      payment: {
        method: head.paymentMethod,
        status: head.paymentStatus,
        razorpayOrderId: head.razorpayOrderId || null,
        razorpayPaymentId: head.razorpayPaymentId || null,
        record: payment || null
      },
      createdByAdmin: parent?.createdByAdmin || null,
      subOrders: parts.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        type: o.subOrderType || (o.fulfillmentType === 'delivery' ? 'DELIVERY_IN_DAYS' : 'IMMEDIATE'),
        status: o.status,
        scheduledFor: o.scheduledFor || null,
        expectedShipDate: o.expectedShipDate || null,
        subscriptionId: o.subscriptionId || null,
        subtotalAmount: Number(o.subtotalAmount),
        taxAmount: Number(o.taxAmount),
        totalAmount: Number(o.totalAmount),
        deliveryAddress: o.deliveryAddress || null,
        trackingLink: o.trackingLink || '',
        createdAt: o.createdAt,
        // order_items when present; the legacy JSONB snapshot otherwise.
        items: itemsBySubOrder[o.id] || (o.items || []).map((i) => ({
          productId: i.id,
          productName: i.name,
          unitPrice: Number(i.price),
          quantity: Number(i.quantity),
          gstRate: Number(i.gstRate ?? 5),
          baseAmount: Number(i.baseAmount ?? 0),
          taxAmount: Number(i.taxAmount ?? 0),
          lineTotal: Number(i.subtotal ?? 0),
          fromLegacySnapshot: true
        }))
      }))
    });
  }

  // ---- plans and wallets, only meaningful for a registered customer ----
  let subscriptions = [];
  let wallets = [];
  if (userId) {
    const subs = await dbGetSubscriptionsByUserId(userId);
    subscriptions = await Promise.all(
      subs.map(async (sub) => ({
        id: sub.id,
        productId: sub.productId,
        frequency: sub.frequency,
        deliveryCount: sub.deliveryCount,
        status: sub.status,
        totalAmount: Number(sub.totalAmount),
        discountPercent: Number(sub.discountPercent),
        perDeliveryAmount: Number(sub.perDeliveryAmount),
        parentOrderId: sub.parentOrderId,
        walletId: sub.walletId,
        walletBalance: sub.walletId ? await dbGetWalletBalance(sub.walletId) : 0,
        deliveries: await dbGetSubscriptionDeliveries(sub.id)
      }))
    );

    const userWallets = await dbGetWalletsByUserId(userId);
    wallets = await Promise.all(
      userWallets.map(async (w) => ({
        id: w.id,
        kind: w.kind,
        subscriptionId: w.subscriptionId,
        isWithdrawable: w.isWithdrawable,
        status: w.status,
        balance: await dbGetWalletBalance(w.id),
        transactions: (await dbGetWalletTransactions(w.id))
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      }))
    );
  }

  const user = userId ? await dbGetUserById(userId).catch(() => null) : null;

  return {
    customer: {
      userId: userId || null,
      username: user?.username || null,
      email: user?.email || null,
      phone: user?.phone || subOrders[0]?.customerPhone || null,
      name: subOrders[0]?.customerName || user?.username || null,
      registered: Boolean(user),
      memberSince: user?.createdAt || null
    },
    totals: {
      orderCount: orders.length,
      subOrderCount: subOrders.length,
      lifetimeValue: roundMoney(
        orders
          .filter((o) => o.payment.status === 'paid')
          .reduce((s, o) => s + Number(o.money.finalAmount || 0), 0)
      ),
      // Refunds are recorded as a payment status today, not as a separate ledger.
      refundedOrders: subOrders.filter((o) => o.paymentStatus === 'refunded').length
    },
    orders,
    subscriptions,
    wallets
  };
}

/**
 * Validates a negotiated price. The admin supplies the agreed FINAL price; the
 * discount is derived, never typed in, so the two can never disagree.
 */
export function resolveNegotiation(calculatedTotal, negotiatedInput) {
  if (negotiatedInput === undefined || negotiatedInput === null || negotiatedInput === '') {
    return { negotiatedTotal: null, negotiatedDiscount: 0, payableTotal: roundMoney(calculatedTotal) };
  }
  // Accept only a number or a numeric string. Number([]) is 0 and Number(true)
  // is 1, so coercing whatever arrives would let an empty array book a free order.
  const isNumeric =
    typeof negotiatedInput === 'number' ||
    (typeof negotiatedInput === 'string' && negotiatedInput.trim() !== '');
  const negotiated = isNumeric ? Number(negotiatedInput) : NaN;
  if (!Number.isFinite(negotiated)) {
    throw domainError('The negotiated price must be a number.', 400, 'INVALID_NEGOTIATED_PRICE');
  }
  if (negotiated < 0) {
    throw domainError('The negotiated price cannot be negative.', 400, 'INVALID_NEGOTIATED_PRICE');
  }
  if (negotiated > calculatedTotal) {
    throw domainError(
      `The negotiated price cannot exceed the calculated total of ${roundMoney(calculatedTotal)}.`,
      400,
      'NEGOTIATED_ABOVE_TOTAL'
    );
  }
  return {
    negotiatedTotal: roundMoney(negotiated),
    negotiatedDiscount: roundMoney(calculatedTotal - negotiated),
    payableTotal: roundMoney(negotiated)
  };
}

export function newAdminOrderId() {
  return `par-${crypto.randomUUID()}`;
}
