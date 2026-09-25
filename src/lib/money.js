// Mirrors server/tax.js so the cart preview matches what the server will charge.
export const DEFAULT_GST_RATE = 5;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function cartTotals(cart) {
  const subtotalAmount = roundMoney(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const taxAmount = roundMoney(cart.reduce(
    (sum, item) => sum + item.price * item.quantity * Number(item.gstRate ?? DEFAULT_GST_RATE) / 100,
    0
  ));
  return { subtotalAmount, taxAmount, totalAmount: roundMoney(subtotalAmount + taxAmount) };
}
