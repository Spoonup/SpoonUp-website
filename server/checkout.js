import crypto from 'crypto';
import {
  dbGetProducts,
  dbCreateOrder,
  generateOrderAccessToken,
  dbGetSettings,
  dbUpdateCheckout,
  dbGetOrdersByRazorpayPaymentId,
  dbGetOrdersByIds,
  dbGetCheckoutById,
  dbClaimCheckout
} from './db.js';
import { calculateLineTax, roundMoney } from './tax.js';

// An unpaid checkout is only valid for this long; prices are snapshotted at prepare time.
export const CHECKOUT_TTL_MS = 30 * 60 * 1000;

export function isCheckoutExpired(checkout) {
  if (!checkout || checkout.status !== 'open') return false;
  const created = new Date(checkout.createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created > CHECKOUT_TTL_MS;
}

// Checkouts store only references to the orders they created; the orders table is the source of truth.
export function orderRefs(orders) {
  return (orders || []).map((o) => ({ id: o.id, fulfillmentType: o.fulfillmentType || 'immediate' }));
}

export async function loadCheckoutOrders(checkout) {
  const refs = Array.isArray(checkout?.createdOrders) ? checkout.createdOrders : [];
  const ids = refs.map((r) => r?.id).filter(Boolean);
  return dbGetOrdersByIds(ids);
}

function domainError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * Takes the fulfilment lock on a checkout. Exactly one caller wins; everyone else
 * either gets the finished orders back (already completed) or a 409 to retry.
 */
export async function claimCheckoutForFulfillment(checkout, fromStatuses) {
  const claimed = await dbClaimCheckout(checkout.id, fromStatuses, 'fulfilling');
  if (claimed) return { claimed };

  const latest = await dbGetCheckoutById(checkout.id);
  if (latest?.status === 'completed') {
    return { completed: latest, orders: await loadCheckoutOrders(latest) };
  }
  if (latest?.status === 'fulfilling') {
    throw domainError('This order is already being processed. Please wait a moment and refresh.', 409, 'CHECKOUT_IN_PROGRESS');
  }
  throw domainError('Checkout session is no longer open.', 400, 'CHECKOUT_NOT_OPEN');
}

export function cleanPhoneNumber(raw) {
  const cleanPhone = String(raw || '').trim().replace(/[^\d+]/g, '');
  const digitsOnly = cleanPhone.replace(/\D/g, '');
  return { cleanPhone, digitsOnly };
}

export function isValidPhone(raw) {
  const { digitsOnly } = cleanPhoneNumber(raw);
  return digitsOnly.length >= 8 && digitsOnly.length <= 18;
}

export function normalizeDeliveryAddress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const line1 = String(raw.line1 || '').trim().slice(0, 120);
  const line2 = String(raw.line2 || '').trim().slice(0, 120);
  const city = String(raw.city || '').trim().slice(0, 60);
  const state = String(raw.state || '').trim().slice(0, 60);
  const pincode = String(raw.pincode || '').trim().slice(0, 12);
  const landmark = String(raw.landmark || '').trim().slice(0, 80);
  if (line1.length < 5 || city.length < 2 || pincode.length < 4) return null;
  return { line1, line2, city, state, pincode, landmark };
}

export async function verifyCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Your cart cannot be empty.');
    err.status = 400;
    throw err;
  }
  if (items.length > 50) {
    const err = new Error('Order exceeds maximum item limit (50 items).');
    err.status = 400;
    throw err;
  }

  const products = await dbGetProducts();
  const productMap = new Map(products.map(p => [p.id, p]));
  let calculatedSubtotal = 0;
  let calculatedTax = 0;
  let calculatedTotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    if (!item || !item.id) {
      const err = new Error('Invalid cart item provided.');
      err.status = 400;
      throw err;
    }
    const prod = productMap.get(item.id);
    if (!prod) {
      const err = new Error('Selected item is not available on the current menu.');
      err.status = 400;
      throw err;
    }
    if (!prod.isAvailable) {
      const err = new Error(`"${prod.name}" is currently sold out.`);
      err.status = 400;
      throw err;
    }
    const qty = Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1));
    const line = calculateLineTax(prod.price, qty, prod.gstRate);
    calculatedSubtotal += line.baseAmount;
    calculatedTax += line.taxAmount;
    calculatedTotal += line.totalAmount;
    verifiedItems.push({
      id: prod.id,
      name: prod.name,
      price: prod.price,
      quantity: qty,
      category: prod.category,
      imageUrl: prod.imageUrl,
      deliverLater: Boolean(prod.deliverLater),
      gstRate: line.taxRate,
      baseAmount: line.baseAmount,
      taxAmount: line.taxAmount,
      subtotal: line.totalAmount
    });
  }

  return {
    verifiedItems,
    calculatedSubtotal: roundMoney(calculatedSubtotal),
    calculatedTax: roundMoney(calculatedTax),
    calculatedTotal: roundMoney(calculatedTotal)
  };
}

export function splitVerifiedItems(verifiedItems) {
  const immediateItems = verifiedItems.filter(i => !i.deliverLater);
  const deliveryItems = verifiedItems.filter(i => i.deliverLater);
  return { immediateItems, deliveryItems };
}

export function cartNeedsDeliveryAddress(verifiedItems) {
  return verifiedItems.some(i => i.deliverLater);
}

export async function createSplitOrders({
  verifiedItems,
  customerName,
  customerPhone,
  notes,
  userId,
  paymentMethod,
  paymentStatus,
  razorpayOrderId,
  razorpayPaymentId,
  deliveryAddress,
  only = 'all',
  paymentGroupId: existingGroupId
}) {
  const { immediateItems, deliveryItems } = splitVerifiedItems(verifiedItems);
  const includeImmediate = only === 'all' || only === 'immediate';
  const includeDelivery = only === 'all' || only === 'delivery';

  if (includeDelivery && deliveryItems.length > 0 && !deliveryAddress) {
    const err = new Error('Delivery address is required for deliver-later items.');
    err.status = 400;
    err.code = 'NEEDS_DELIVERY_ADDRESS';
    throw err;
  }

  const settings = await dbGetSettings();
  const paymentGroupId = existingGroupId || `pay-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const created = [];

  const base = {
    customerName,
    customerPhone,
    notes: notes || '',
    counterName: settings.counterName || 'Main Shop',
    userId: userId || null,
    paymentGroupId,
    paymentMethod,
    paymentStatus,
    razorpayOrderId: razorpayOrderId || '',
    razorpayPaymentId: razorpayPaymentId || '',
    createdAt: now,
    updatedAt: now
  };

  if (includeImmediate && immediateItems.length > 0) {
    const subtotalAmount = roundMoney(immediateItems.reduce((sum, i) => sum + i.baseAmount, 0));
    const taxAmount = roundMoney(immediateItems.reduce((sum, i) => sum + i.taxAmount, 0));
    const totalAmount = roundMoney(subtotalAmount + taxAmount);
    const immediatePaid = paymentStatus === 'paid';
    created.push(await dbCreateOrder({
      ...base,
      id: `ord-${crypto.randomUUID()}`,
      items: immediateItems,
      subtotalAmount,
      taxAmount,
      totalAmount,
      status: immediatePaid ? 'preparing' : 'pending',
      fulfillmentType: 'immediate',
      deliveryAddress: null,
      trackingLink: '',
      accessToken: generateOrderAccessToken()
    }));
  }

  if (includeDelivery && deliveryItems.length > 0) {
    const subtotalAmount = roundMoney(deliveryItems.reduce((sum, i) => sum + i.baseAmount, 0));
    const taxAmount = roundMoney(deliveryItems.reduce((sum, i) => sum + i.taxAmount, 0));
    const totalAmount = roundMoney(subtotalAmount + taxAmount);
    created.push(await dbCreateOrder({
      ...base,
      id: `ord-${crypto.randomUUID()}`,
      items: deliveryItems,
      subtotalAmount,
      taxAmount,
      totalAmount,
      status: 'pending',
      fulfillmentType: 'delivery',
      deliveryAddress,
      trackingLink: '',
      accessToken: generateOrderAccessToken()
    }));
  }

  return created;
}

export async function fulfillPaidCheckout(checkout, { paymentId, deliveryAddress, allowMissingDeliveryAddress = false }) {
  if (checkout.status === 'completed') {
    const existing = await loadCheckoutOrders(checkout);
    if (existing.length) return { checkout, orders: existing, alreadyCompleted: true };
  }

  const claim = await claimCheckoutForFulfillment(checkout, ['open', 'paid']);
  if (claim.completed) {
    return { checkout: claim.completed, orders: claim.orders, alreadyCompleted: true };
  }
  const active = claim.claimed;
  const previousStatus = checkout.status;

  try {
    const fromCheckout = await loadCheckoutOrders(active);
    const fromPayment = paymentId ? await dbGetOrdersByRazorpayPaymentId(paymentId) : [];
    const merged = new Map();
    for (const order of [...fromCheckout, ...fromPayment]) {
      if (order?.id) merged.set(order.id, order);
    }
    let created = [...merged.values()];

    const address = deliveryAddress || active.deliveryAddress || null;
    const hasImmediate = active.items.some((item) => !item.deliverLater);
    const hasDelivery = active.items.some((item) => item.deliverLater);
    const alreadyImmediate = created.some((o) => o.fulfillmentType === 'immediate');
    const alreadyDelivery = created.some((o) => o.fulfillmentType === 'delivery');
    const paymentGroupId = created.find((o) => o.paymentGroupId)?.paymentGroupId;

    const common = {
      verifiedItems: active.items,
      customerName: active.customerName,
      customerPhone: active.customerPhone,
      notes: active.notes,
      userId: active.userId || null,
      paymentMethod: active.paymentMethod,
      paymentStatus: 'paid',
      razorpayOrderId: active.razorpayOrderId || '',
      razorpayPaymentId: paymentId,
      deliveryAddress: address
    };

    if (hasImmediate && !alreadyImmediate) {
      created = created.concat(await createSplitOrders({ ...common, only: 'immediate', paymentGroupId }));
    }

    if (hasDelivery && !alreadyDelivery) {
      if (!address) {
        if (!allowMissingDeliveryAddress) {
          throw domainError('Delivery address is required for deliver-later items.', 400, 'NEEDS_DELIVERY_ADDRESS');
        }
      } else {
        created = created.concat(await createSplitOrders({
          ...common,
          only: 'delivery',
          paymentGroupId: created.find((o) => o.paymentGroupId)?.paymentGroupId || paymentGroupId
        }));
      }
    }

    const deliveryStillPending = hasDelivery && !created.some((o) => o.fulfillmentType === 'delivery');
    const status = deliveryStillPending ? 'paid' : 'completed';

    const updated = await dbUpdateCheckout(active.id, {
      status,
      razorpayPaymentId: paymentId || active.razorpayPaymentId || '',
      deliveryAddress: address,
      createdOrders: orderRefs(created)
    });

    return { checkout: updated, orders: created, alreadyCompleted: false };
  } catch (err) {
    // Release the lock so the webhook or a client retry can finish the job.
    await dbUpdateCheckout(active.id, { status: previousStatus }).catch(() => {});
    throw err;
  }
}
