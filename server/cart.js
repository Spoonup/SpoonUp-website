import { dbGetProducts } from './db.js';
import { resolvePlatformPricing, normalizePlatform } from './pricing.js';
import { calculateLineTax, roundMoney } from './tax.js';
import {
  fulfillmentConfig,
  isSellableOnce,
  isSubscribable,
  leadTimeDays,
  resolveFulfillmentKind,
  subOrderTypeFor
} from './catalog.js';
import {
  isFrequency,
  isValidDurationMonths,
  quoteSubscription
} from './subscriptions.js';

/**
 * Cart validation. A cart may mix fulfilment kinds and purchase modes freely;
 * this turns raw {id, quantity, purchaseMode, scheduledFor, frequency,
 * durationMonths} lines into validated, priced parts.
 *
 * The client sends identifiers and quantities only. Every price, tax figure and
 * total here is computed from the product row — a client-supplied amount is
 * never read.
 */

export const MAX_CART_LINES = 50;
export const MAX_LINE_QTY = 50;
// A slot must be far enough out to cook, and not so far it outlives the menu.
export const MIN_SCHEDULE_LEAD_MINUTES = 30;
export const MAX_SCHEDULE_DAYS = 30;

function bad(message, code = 'INVALID_CART') {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

/** ISO timestamp in the future, within the bookable window. */
export function validateScheduledFor(raw, now = Date.now()) {
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    throw bad('Scheduled time is not a valid date.', 'INVALID_SCHEDULE');
  }
  const deltaMs = when.getTime() - now;
  if (deltaMs < MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000) {
    throw bad(
      `Scheduled orders need at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes' notice.`,
      'SCHEDULE_TOO_SOON'
    );
  }
  if (deltaMs > MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
    throw bad(`Scheduled orders can be booked up to ${MAX_SCHEDULE_DAYS} days ahead.`, 'SCHEDULE_TOO_FAR');
  }
  return when.toISOString();
}

function validateLineShape(raw, index) {
  if (!raw || typeof raw !== 'object' || !raw.id) {
    throw bad(`Cart line ${index + 1} is malformed.`);
  }
  const mode = raw.purchaseMode === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'ONE_OFF';
  const qty = Math.max(1, Math.min(MAX_LINE_QTY, parseInt(raw.quantity, 10) || 1));
  return { mode, qty };
}

/**
 * Validates and prices every line.
 * Returns { lines, parts, totals, needsShippingAddress } where `parts` are the
 * groups that will become sub-orders, plus any subscription intents.
 */
export async function buildCart(
  rawLines,
  { now = Date.now(), products: injected, platform = 'WEB', platformRules } = {}
) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw bad('Your cart cannot be empty.', 'EMPTY_CART');
  }
  if (rawLines.length > MAX_CART_LINES) {
    throw bad(`Order exceeds the maximum of ${MAX_CART_LINES} lines.`, 'CART_TOO_LARGE');
  }

  const products = injected || (await dbGetProducts());
  const byId = new Map(products.map((p) => [p.id, p]));
  // Platform pricing is resolved server-side for every line before anything is
  // totalled; the client's platform string selects a rule, never a price.
  const plat = normalizePlatform(platform);
  const priceMap = await resolvePlatformPricing(products, plat, { rules: platformRules, now });
  const effectivePrice = (product) => priceMap.get(product.id)?.price ?? product.price;
  const lines = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const { mode, qty } = validateLineShape(raw, i);
    const product = byId.get(raw.id);

    if (!product) throw bad('Selected item is not available on the current menu.', 'PRODUCT_NOT_FOUND');
    if (!product.isAvailable) throw bad(`"${product.name}" is currently sold out.`, 'PRODUCT_SOLD_OUT');

    const kind = resolveFulfillmentKind(product);
    const cfg = fulfillmentConfig(product);

    if (mode === 'SUBSCRIPTION') {
      if (!isSubscribable(product)) {
        throw bad(`"${product.name}" cannot be bought on a plan.`, 'NOT_SUBSCRIBABLE');
      }
      if (!isFrequency(raw.frequency)) throw bad('Choose a valid delivery frequency.', 'INVALID_SUBSCRIPTION');
      if (!isValidDurationMonths(raw.durationMonths)) {
        throw bad('Choose a valid plan duration.', 'INVALID_SUBSCRIPTION');
      }
      // A plan is one commitment; quantity is expressed as deliveries.
      if (qty !== 1) throw bad('A subscription line must have quantity 1.', 'INVALID_SUBSCRIPTION');
      if (raw.scheduledFor) {
        throw bad('A subscription sets its own schedule; remove the one-off slot.', 'INVALID_SUBSCRIPTION');
      }

      const quote = quoteSubscription({
        unitPrice: effectivePrice(product),
        gstRate: product.gstRate,
        frequency: raw.frequency,
        durationMonths: raw.durationMonths
      });
      const startDate = raw.startDate
        ? validateScheduledFor(raw.startDate, now).slice(0, 10)
        : new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      lines.push({
        productId: product.id,
        name: product.name,
        purchaseMode: 'SUBSCRIPTION',
        fulfillmentKind: kind,
        subOrderType: 'SUBSCRIPTION_DELIVERY',
        quantity: 1,
        unitPrice: roundMoney(effectivePrice(product)),
        gstRate: quote.gstRate,
        baseAmount: quote.subtotalAmount,
        taxAmount: quote.taxAmount,
        lineTotal: quote.totalAmount,
        subscription: { ...quote, startDate, productId: product.id }
      });
      continue;
    }

    if (!isSellableOnce(product)) {
      throw bad(`"${product.name}" is only available on a plan.`, 'PLAN_ONLY');
    }

    let scheduledFor = null;
    if (raw.scheduledFor) {
      if (!cfg.schedulableAs) {
        throw bad(`"${product.name}" cannot be scheduled for a future slot.`, 'NOT_SCHEDULABLE');
      }
      scheduledFor = validateScheduledFor(raw.scheduledFor, now);
    }

    const unit = effectivePrice(product);
    const tax = calculateLineTax(unit, qty, product.gstRate);
    lines.push({
      productId: product.id,
      name: product.name,
      purchaseMode: 'ONE_OFF',
      basePrice: roundMoney(product.price),
      platformAdjustment: roundMoney(priceMap.get(product.id)?.adjustment || 0),
      fulfillmentKind: kind,
      subOrderType: subOrderTypeFor({ product, purchaseMode: 'ONE_OFF', scheduledFor }),
      quantity: qty,
      unitPrice: roundMoney(unit),
      gstRate: tax.taxRate,
      baseAmount: tax.baseAmount,
      taxAmount: tax.taxAmount,
      lineTotal: tax.totalAmount,
      scheduledFor,
      expectedShipDays: kind === 'DELIVERY_IN_DAYS' ? leadTimeDays(product) : 0,
      category: product.category,
      imageUrl: product.imageUrl,
      deliverLater: kind === 'DELIVERY_IN_DAYS'
    });
  }

  return { lines, platform: plat, ...groupIntoParts(lines) };
}

/**
 * Groups validated lines into the parts that become sub-orders.
 * Key = subOrderType + slot, so two different slots are two sub-orders.
 * Subscription lines are returned separately: they create a plan, not a
 * sub-order, at checkout time.
 */
export function groupIntoParts(lines) {
  const parts = new Map();
  const subscriptionIntents = [];

  for (const line of lines) {
    if (line.purchaseMode === 'SUBSCRIPTION') {
      subscriptionIntents.push(line);
      continue;
    }
    const key = `${line.subOrderType}::${line.scheduledFor || ''}`;
    if (!parts.has(key)) {
      parts.set(key, {
        key,
        subOrderType: line.subOrderType,
        fulfillmentKind: line.fulfillmentKind,
        scheduledFor: line.scheduledFor || null,
        expectedShipDays: line.expectedShipDays || 0,
        lines: []
      });
    }
    const part = parts.get(key);
    part.lines.push(line);
    part.expectedShipDays = Math.max(part.expectedShipDays, line.expectedShipDays || 0);
  }

  const grouped = [...parts.values()].map((part) => {
    const subtotalAmount = roundMoney(part.lines.reduce((s, l) => s + l.baseAmount, 0));
    const taxAmount = roundMoney(part.lines.reduce((s, l) => s + l.taxAmount, 0));
    return { ...part, subtotalAmount, taxAmount, totalAmount: roundMoney(subtotalAmount + taxAmount) };
  });

  const partsTotal = grouped.reduce((s, p) => s + p.totalAmount, 0);
  const subsTotal = subscriptionIntents.reduce((s, l) => s + l.lineTotal, 0);

  return {
    parts: grouped,
    subscriptionIntents,
    needsShippingAddress: grouped.some((p) => p.subOrderType === 'DELIVERY_IN_DAYS'),
    totals: {
      itemsSubtotal: roundMoney(
        grouped.reduce((s, p) => s + p.subtotalAmount, 0) +
          subscriptionIntents.reduce((s, l) => s + l.baseAmount, 0)
      ),
      taxTotal: roundMoney(
        grouped.reduce((s, p) => s + p.taxAmount, 0) +
          subscriptionIntents.reduce((s, l) => s + l.taxAmount, 0)
      ),
      calculatedTotal: roundMoney(partsTotal + subsTotal)
    }
  };
}
