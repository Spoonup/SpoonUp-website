import { dbGetPlatformPriceRules } from './db.js';
import { roundMoney } from './tax.js';

/**
 * Platform pricing.
 *
 * The same product can cost differently on WEB, ANDROID and IOS — typically to
 * absorb an app-store cut. The adjustment is resolved HERE, on the server, from
 * `platform_price_rules`, and applied to the server's own base price. A client
 * never supplies a price, a discount or a total; it supplies identifiers and a
 * platform string, and everything else is computed.
 *
 * Rule precedence is most-specific-first: PRODUCT beats CATEGORY beats GLOBAL.
 * Exactly one rule applies per line — adjustments never stack.
 */

export const PLATFORMS = ['WEB', 'ANDROID', 'IOS'];
export const DEFAULT_PLATFORM = 'WEB';

export function normalizePlatform(value) {
  const p = String(value || '').toUpperCase();
  return PLATFORMS.includes(p) ? p : DEFAULT_PLATFORM;
}

function isLive(rule, now) {
  if (rule.isActive === false) return false;
  if (rule.effectiveFrom && new Date(rule.effectiveFrom).getTime() > now) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < now) return false;
  return true;
}

/** Most specific live rule for this product on this platform, or null. */
export function selectRule(rules, { platform, productId, category }, now = Date.now()) {
  const live = rules.filter((r) => r.platform === platform && isLive(r, now));
  return (
    live.find((r) => r.scope === 'PRODUCT' && r.scopeRef === productId) ||
    live.find((r) => r.scope === 'CATEGORY' && r.scopeRef === category) ||
    live.find((r) => r.scope === 'GLOBAL') ||
    null
  );
}

/** Applies one rule to a base price. Never returns a negative price. */
export function applyRule(basePrice, rule) {
  if (!rule) return { price: roundMoney(basePrice), adjustment: 0, ruleId: null };
  const base = Number(basePrice);
  const delta =
    rule.adjustmentType === 'PERCENT'
      ? (base * Number(rule.adjustmentValue)) / 100
      : Number(rule.adjustmentValue);
  const price = Math.max(0, roundMoney(base + delta));
  return { price, adjustment: roundMoney(price - base), ruleId: rule.id };
}

/**
 * Resolves the effective unit price for every product on a platform.
 * Returns a Map keyed by product id so the cart can price lines in one pass.
 */
export async function resolvePlatformPricing(products, platform, { rules: injected, now } = {}) {
  const plat = normalizePlatform(platform);
  const rules = injected || (await dbGetPlatformPriceRules());
  const at = now || Date.now();
  const out = new Map();
  for (const product of products) {
    const rule = selectRule(rules, { platform: plat, productId: product.id, category: product.category }, at);
    const { price, adjustment, ruleId } = applyRule(product.price, rule);
    out.set(product.id, { basePrice: roundMoney(product.price), price, adjustment, ruleId, platform: plat });
  }
  return out;
}
