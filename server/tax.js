export const DEFAULT_GST_RATE = 5;

export function normalizeGstRate(value, fallback = DEFAULT_GST_RATE) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100
    ? Math.round(rate * 100) / 100
    : fallback;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateLineTax(price, quantity, gstRate) {
  const baseAmount = roundMoney(Number(price) * Number(quantity));
  const taxRate = normalizeGstRate(gstRate);
  const taxAmount = roundMoney(baseAmount * taxRate / 100);
  return {
    baseAmount,
    taxRate,
    taxAmount,
    totalAmount: roundMoney(baseAmount + taxAmount)
  };
}
