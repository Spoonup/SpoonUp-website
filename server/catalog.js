/**
 * Product fulfilment taxonomy.
 *
 * `fulfillmentKind` describes HOW a product reaches the customer. `subscribable`
 * describes WHETHER it can also be bought on a recurring plan — the same jar is
 * sold both ways, so subscription is a purchase mode, not a product type.
 *
 * Adding a kind is a data change plus one entry in FULFILLMENT_KINDS and one
 * status machine; nothing branches on a category name.
 */

export const FULFILLMENT_KINDS = {
  IMMEDIATE: {
    id: 'IMMEDIATE',
    label: 'Made now',
    // The sub-order type a plain "buy now" line produces.
    subOrderType: 'IMMEDIATE',
    // Same product bought for a future slot.
    schedulableAs: 'SCHEDULED',
    needsShippingAddress: false,
    defaultPrepMinutes: 40
  },
  DELIVERY_IN_DAYS: {
    id: 'DELIVERY_IN_DAYS',
    label: 'Sourced to order',
    subOrderType: 'DELIVERY_IN_DAYS',
    schedulableAs: null,
    needsShippingAddress: true,
    defaultLeadTimeDays: 4
  }
};

export const FULFILLMENT_KIND_IDS = Object.keys(FULFILLMENT_KINDS);

/** Purchase modes a cart line may request. */
export const PURCHASE_MODES = ['ONE_OFF', 'SUBSCRIPTION'];

export function isFulfillmentKind(value) {
  return Object.prototype.hasOwnProperty.call(FULFILLMENT_KINDS, String(value || ''));
}

/**
 * Resolves a product's kind. Older rows carry only the `deliverLater` boolean,
 * so it is the fallback rather than a parallel source of truth.
 */
export function resolveFulfillmentKind(product) {
  if (!product) return 'IMMEDIATE';
  if (isFulfillmentKind(product.fulfillmentKind)) return product.fulfillmentKind;
  return product.deliverLater ? 'DELIVERY_IN_DAYS' : 'IMMEDIATE';
}

export function fulfillmentConfig(product) {
  return FULFILLMENT_KINDS[resolveFulfillmentKind(product)];
}

export function isSubscribable(product) {
  return Boolean(product?.subscribable);
}

/** A product may be withdrawn from one-off sale while staying on plans. */
export function isSellableOnce(product) {
  return product?.sellableOnce !== false;
}

export function leadTimeDays(product) {
  const cfg = fulfillmentConfig(product);
  if (cfg.id !== 'DELIVERY_IN_DAYS') return 0;
  const explicit = Number(product?.leadTimeDays);
  return Number.isFinite(explicit) && explicit > 0 ? Math.round(explicit) : cfg.defaultLeadTimeDays;
}

export function prepMinutes(product) {
  const cfg = fulfillmentConfig(product);
  if (cfg.id !== 'IMMEDIATE') return 0;
  const explicit = Number(product?.prepMinutes);
  return Number.isFinite(explicit) && explicit > 0 ? Math.round(explicit) : cfg.defaultPrepMinutes;
}

/**
 * The sub-order type a verified cart line becomes.
 * SCHEDULED is reachable only from an IMMEDIATE product given a future slot, and
 * never carries a subscription reference — that is what keeps the two apart.
 */
export function subOrderTypeFor({ product, purchaseMode = 'ONE_OFF', scheduledFor = null }) {
  const cfg = fulfillmentConfig(product);
  if (purchaseMode === 'SUBSCRIPTION') return 'SUBSCRIPTION_DELIVERY';
  if (scheduledFor && cfg.schedulableAs) return cfg.schedulableAs;
  return cfg.subOrderType;
}
