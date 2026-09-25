import { calculateLineTax, roundMoney } from './tax.js';

/**
 * Subscription shape and pricing.
 *
 * Discount is a function of DELIVERY COUNT, never duration — a 30-delivery
 * alternate-day plan over two months earns the same tier as a 30-delivery daily
 * plan over one. Tiers live in data (DEFAULT_PRICING_TIERS, overridable from
 * settings) so changing them never touches this math.
 */

export const FREQUENCIES = {
  DAILY: { id: 'DAILY', label: 'Every day', everyNDays: 1, perWeek: 7 },
  ALTERNATE_DAYS: { id: 'ALTERNATE_DAYS', label: 'Alternate days', everyNDays: 2, perWeek: 3.5 },
  TWICE_WEEKLY: { id: 'TWICE_WEEKLY', label: 'Twice a week', everyNDays: 3.5, perWeek: 2 },
  WEEKLY: { id: 'WEEKLY', label: 'Weekly', everyNDays: 7, perWeek: 1 }
};

export const FREQUENCY_IDS = Object.keys(FREQUENCIES);

// Durations are open-ended: any whole number of months within bounds is valid,
// so adding "6 months" needs no code change.
export const MIN_DURATION_MONTHS = 1;
export const MAX_DURATION_MONTHS = 12;
const DAYS_PER_MONTH = 30;

/** min/max are inclusive delivery counts; max null means open-ended. */
export const DEFAULT_PRICING_TIERS = [
  { id: 'tier-0', minDeliveries: 1, maxDeliveries: 11, discountPercent: 0 },
  { id: 'tier-1', minDeliveries: 12, maxDeliveries: 29, discountPercent: 8 },
  { id: 'tier-2', minDeliveries: 30, maxDeliveries: 59, discountPercent: 14 },
  { id: 'tier-3', minDeliveries: 60, maxDeliveries: null, discountPercent: 18 }
];

export function isFrequency(value) {
  return Object.prototype.hasOwnProperty.call(FREQUENCIES, String(value || ''));
}

export function isValidDurationMonths(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_DURATION_MONTHS && n <= MAX_DURATION_MONTHS;
}

/** How many deliveries a frequency yields over a duration. */
export function deliveryCountFor(frequency, durationMonths) {
  const freq = FREQUENCIES[frequency];
  if (!freq || !isValidDurationMonths(durationMonths)) return 0;
  const days = durationMonths * DAYS_PER_MONTH;
  return Math.max(1, Math.floor(days / freq.everyNDays));
}

export function resolveTier(deliveryCount, tiers = DEFAULT_PRICING_TIERS) {
  const n = Number(deliveryCount) || 0;
  return (
    tiers.find(
      (t) => n >= t.minDeliveries && (t.maxDeliveries == null || n <= t.maxDeliveries)
    ) || tiers[0]
  );
}

/**
 * Full upfront quote. The tier is snapshotted onto the returned object so a
 * later tier change cannot restate a plan that has already been paid for.
 */
export function quoteSubscription({ unitPrice, gstRate, frequency, durationMonths, tiers }) {
  const deliveryCount = deliveryCountFor(frequency, durationMonths);
  if (deliveryCount <= 0) {
    const err = new Error('Invalid subscription frequency or duration.');
    err.status = 400;
    err.code = 'INVALID_SUBSCRIPTION';
    throw err;
  }
  const tier = resolveTier(deliveryCount, tiers);
  const grossBase = roundMoney(Number(unitPrice) * deliveryCount);
  const discountAmount = roundMoney((grossBase * tier.discountPercent) / 100);
  const netBase = roundMoney(grossBase - discountAmount);
  // Tax is charged on the discounted base, computed with the shared helper.
  const taxed = calculateLineTax(netBase, 1, gstRate);
  const perDelivery = roundMoney(taxed.totalAmount / deliveryCount);

  return {
    frequency,
    durationMonths,
    deliveryCount,
    unitPrice: roundMoney(unitPrice),
    gstRate: taxed.taxRate,
    tierId: tier.id,
    discountPercent: tier.discountPercent,
    grossAmount: grossBase,
    discountAmount,
    subtotalAmount: netBase,
    taxAmount: taxed.taxAmount,
    totalAmount: taxed.totalAmount,
    perDeliveryAmount: perDelivery
  };
}

/** Planned delivery dates. Pure — the caller decides the start date. */
export function buildDeliverySchedule({ startDate, frequency, deliveryCount }) {
  const freq = FREQUENCIES[frequency];
  if (!freq) return [];
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return [];
  const rows = [];
  let cursor = 0;
  for (let i = 0; i < deliveryCount; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + Math.round(cursor));
    rows.push({ sequenceNo: i + 1, scheduledDate: d.toISOString().slice(0, 10) });
    cursor += freq.everyNDays;
  }
  return rows;
}
