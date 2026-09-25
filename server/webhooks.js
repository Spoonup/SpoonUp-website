import crypto from 'crypto';
import {
  dbRecordPaymentEvent,
  dbMarkPaymentEventProcessed,
  dbGetPaymentByGatewayOrderId,
  dbUpdatePayment,
  dbCreateRefund,
  dbGetCheckoutById,
  dbGetCheckoutByRazorpayOrderId,
  dbUpdateCheckout,
  dbGetOrdersByRazorpayPaymentId,
  dbUpdateOrder
} from './db.js';
import { fulfillPaidCheckout } from './checkout.js';

function entity(payload, key) {
  return payload?.[key]?.entity || null;
}

function expectedPaise(checkout) {
  return Math.round(Number(checkout.amount) * 100);
}

/**
 * Fail CLOSED. A payload with no usable amount cannot be reconciled against the
 * checkout, so it must not fulfil an order — the previous `return true` here
 * meant a malformed event slipped through the one check that guards the amount.
 */
function amountsMatch(checkout, paise) {
  const value = Number(paise);
  if (paise == null || !Number.isFinite(value)) return false;
  return expectedPaise(checkout) === value;
}

async function findCheckout({ razorpayOrderId, checkoutId }) {
  if (razorpayOrderId) {
    const byOrder = await dbGetCheckoutByRazorpayOrderId(razorpayOrderId);
    if (byOrder) return byOrder;
  }
  if (checkoutId) {
    return dbGetCheckoutById(String(checkoutId));
  }
  return null;
}

async function fulfillFromPayment(checkout, payment, sourceAmount) {
  if (!checkout || checkout.paymentMethod !== 'online') {
    return { ignored: true, reason: 'checkout_not_online' };
  }
  if (checkout.status === 'cancelled') {
    return { ignored: true, reason: 'checkout_cancelled' };
  }
  if (!amountsMatch(checkout, sourceAmount ?? payment?.amount)) {
    console.error('[Razorpay Webhook] Amount mismatch', checkout.id, payment?.id);
    return { ignored: true, reason: 'amount_mismatch' };
  }

  const paymentId = String(payment?.id || checkout.razorpayPaymentId || '');
  if (!paymentId) {
    return { ignored: true, reason: 'missing_payment_id' };
  }

  let result;
  try {
    result = await fulfillPaidCheckout(checkout, {
      paymentId,
      deliveryAddress: checkout.deliveryAddress || null,
      allowMissingDeliveryAddress: true
    });
  } catch (err) {
    // Another worker (usually the customer's browser) holds the fulfilment lock.
    // Ask Razorpay to retry later so the webhook still acts as the safety net.
    if (err.code === 'CHECKOUT_IN_PROGRESS') {
      return { ignored: true, reason: 'in_progress', retry: true };
    }
    throw err;
  }
  return {
    ignored: false,
    checkoutId: checkout.id,
    status: result.checkout?.status,
    orderCount: result.orders?.length || 0,
    alreadyCompleted: result.alreadyCompleted
  };
}

async function markCheckoutFailed(checkout, paymentId) {
  if (!checkout || ['completed', 'paid', 'cancelled'].includes(checkout.status)) {
    return { ignored: true, reason: 'checkout_not_open' };
  }
  await dbUpdateCheckout(checkout.id, {
    status: 'failed',
    razorpayPaymentId: paymentId || checkout.razorpayPaymentId || ''
  });
  return { ignored: false, checkoutId: checkout.id, status: 'failed' };
}

async function markOrdersRefunded(paymentId, refundPaise) {
  if (!paymentId) return { ignored: true, reason: 'missing_payment_id' };
  const orders = await dbGetOrdersByRazorpayPaymentId(paymentId);
  if (!orders.length) {
    return { ignored: true, reason: 'orders_not_found' };
  }
  // A partial refund must not flip the whole payment group to refunded; staff handle
  // those manually from the dashboard.
  const paidPaise = Math.round(orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0) * 100);
  if (refundPaise != null && Number.isFinite(Number(refundPaise)) && Number(refundPaise) < paidPaise) {
    console.warn('[Razorpay Webhook] Partial refund received; orders left unchanged', paymentId, refundPaise, paidPaise);
    return { ignored: true, reason: 'partial_refund' };
  }
  for (const order of orders) {
    if (order.paymentStatus === 'refunded' && order.status === 'refunded') continue;
    await dbUpdateOrder(order.id, { status: 'refunded', paymentStatus: 'refunded' });
  }
  return { ignored: false, refunded: orders.length };
}

/**
 * Every webhook is journalled under its gateway event id before any work. A
 * redelivery — which Razorpay does freely — collides on that unique id and
 * returns immediately, so replay costs one insert attempt and changes nothing.
 * `eventId` comes from the x-razorpay-event-id header.
 */
export async function handleRazorpayWebhookEvent(event, { eventId } = {}) {
  const name = String(event?.event || '');
  const payloadPayment = event?.payload?.payment?.entity || null;
  const payloadOrder = event?.payload?.order?.entity || null;

  // Fall back to a content hash when the header is absent, so the journal still
  // de-duplicates rather than silently letting every replay through.
  const journalId =
    eventId ||
    `sha:${crypto.createHash('sha256').update(JSON.stringify(event || {})).digest('hex').slice(0, 32)}`;

  const { duplicate } = await dbRecordPaymentEvent({
    id: `pev-${crypto.randomUUID()}`,
    gateway: 'RAZORPAY',
    gatewayEventId: journalId,
    eventType: name,
    gatewayPaymentId: payloadPayment?.id || null,
    gatewayOrderId: payloadPayment?.order_id || payloadOrder?.id || null,
    rawPayload: event || null,
    receivedAt: new Date().toISOString()
  });

  if (duplicate) {
    return { ignored: true, reason: 'duplicate_event', eventId: journalId };
  }

  const outcome = await dispatchEvent(event, name);
  await dbMarkPaymentEventProcessed(journalId, outcome.reason || (outcome.ignored ? 'ignored' : 'processed'))
    .catch(() => {});
  await syncPaymentRecord(event, name).catch(() => {});
  return { ...outcome, eventId: journalId };
}

/** Keeps the payments row in step with what the gateway reports. */
async function syncPaymentRecord(event, name) {
  const payment = event?.payload?.payment?.entity || null;
  const order = event?.payload?.order?.entity || null;
  const gatewayOrderId = payment?.order_id || order?.id || '';
  if (!gatewayOrderId) return;
  const record = await dbGetPaymentByGatewayOrderId(gatewayOrderId);
  if (!record) return;

  if (name === 'payment.captured' || name === 'order.paid') {
    await dbUpdatePayment(record.id, {
      status: 'CAPTURED',
      gatewayPaymentId: payment?.id || record.gatewayPaymentId,
      methodDetail: payment?.method || record.methodDetail,
      capturedAt: new Date().toISOString()
    });
  } else if (name === 'payment.failed') {
    await dbUpdatePayment(record.id, {
      status: 'FAILED',
      gatewayPaymentId: payment?.id || record.gatewayPaymentId,
      failureReason: String(payment?.error_description || '').slice(0, 200)
    });
  } else if (name.startsWith('refund.')) {
    const refund = event?.payload?.refund?.entity || null;
    const paidPaise = Math.round(Number(record.amount) * 100);
    const isPartial = refund?.amount != null && Number(refund.amount) < paidPaise;
    await dbUpdatePayment(record.id, { status: isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED' });
    if (refund?.id) {
      await dbCreateRefund({
        id: `ref-${crypto.randomUUID()}`,
        paymentId: record.id,
        gatewayRefundId: refund.id,
        amount: Number(refund.amount || 0) / 100,
        isPartial,
        status: refund.status || 'processed',
        reason: 'Gateway refund',
        createdByAdmin: null,
        createdAt: new Date().toISOString()
      }).catch(() => {});
    }
  }
}

async function dispatchEvent(event, name) {
  const payload = event?.payload || {};
  const payment = entity(payload, 'payment');
  const order = entity(payload, 'order');
  const refund = entity(payload, 'refund');
  const razorpayOrderId = payment?.order_id || order?.id || '';
  const checkoutId = payment?.notes?.checkoutId || order?.notes?.checkoutId || '';
  const checkout = await findCheckout({ razorpayOrderId, checkoutId });
  const paymentCaptured =
    name === 'payment.captured' ||
    name === 'order.paid' ||
    (name === 'payment.authorized' && (payment?.captured === true || payment?.status === 'captured'));

  if (paymentCaptured) {
    if (!checkout) return { ignored: true, reason: 'checkout_not_found' };
    return fulfillFromPayment(
      checkout,
      payment || { id: payment?.id, amount: order?.amount },
      order?.amount || payment?.amount
    );
  }

  if (name === 'payment.failed' || name === 'order.paid.failed') {
    if (!checkout) return { ignored: true, reason: 'checkout_not_found' };
    return markCheckoutFailed(checkout, payment?.id);
  }

  if (name === 'refund.created' || name === 'refund.processed' || name === 'refund.speed_changed') {
    const paymentId = refund?.payment_id || payment?.id || '';
    return markOrdersRefunded(paymentId, refund?.amount);
  }

  return { ignored: true, reason: 'unhandled_event' };
}
