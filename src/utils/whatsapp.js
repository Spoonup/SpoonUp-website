import { get } from 'node-emoji';

/**
 * Curated minimal emojis for SpoonUp order updates.
 * Using unicode points resolved via node-emoji ensures universal compatibility
 * across iOS, Android, macOS, Windows and WhatsApp Web.
 */
export const EMOJIS = {
  sparkles: get('sparkles') || '✨',
  greenCircle: get('green_circle') || '🟢',
  receipt: get('receipt') || '🧾',
  pin: get('round_pushpin') || '📍',
  check: get('white_check_mark') || '✅',
  herb: get('herb') || '🌿',
};

/**
 * Builds a clean, minimal WhatsApp message for order pickup notifications.
 * Formatted with markdown styling supported natively by WhatsApp.
 *
 * @param {Object} order - The order object
 * @param {Object} settings - Application settings (currency, counter name, event name)
 * @returns {string} Formatted text message
 */
export function buildOrderReadyWhatsAppMessage(order, settings = {}) {
  const currency = settings.currencySymbol || '₹';
  const location = order.counterName || settings.counterName || 'Main Shop';

  const itemsList = (order.items || [])
    .map(item => `  • ${item.quantity}x ${item.name}`)
    .join('\n');

  return [
    `*SpoonUp* ${EMOJIS.sparkles} *Order Ready for Pickup!* ${EMOJIS.greenCircle}`,
    ``,
    `Hi *${order.customerName}*, your order is freshly prepared and ready for pickup.`,
    ``,
    `${EMOJIS.receipt} *Order #${order.orderNumber}*`,
    itemsList,
    ``,
    `${EMOJIS.check} *Total:* ${currency}${order.totalAmount} (Paid)`,
    `${EMOJIS.pin} *Pickup:* ${location}`,
    ``,
    `_Real Food. Real Nutrition. Real Goodness._`,
    `_Please show this message at ${location} to collect your order. Enjoy!_ ${EMOJIS.sparkles}`
  ].join('\n');
}

/**
 * Creates the direct WhatsApp URL for sending the notification.
 * Uses `https://api.whatsapp.com/send` directly instead of `wa.me` redirect
 * to prevent double HTTP 302 character encoding corruption on 4-byte UTF-8 emojis.
 *
 * @param {string} phone - Customer phone number
 * @param {string} message - Unencoded message text
 * @returns {string} Full WhatsApp URL
 */
export function getWhatsAppUrl(phone, message) {
  const rawPhone = String(phone || '').replace(/\D/g, '');
  const encoded = encodeURIComponent(message);
  return `https://api.whatsapp.com/send?phone=${rawPhone}&text=${encoded}`;
}

/**
 * Opens WhatsApp in a new tab with the pre-filled message.
 *
 * @param {Object} order - The order object
 * @param {Object} settings - Application settings
 */
export function openWhatsAppNotification(order, settings = {}) {
  const message = buildOrderReadyWhatsAppMessage(order, settings);
  const url = getWhatsAppUrl(order.customerPhone, message);
  window.open(url, '_blank', 'noopener,noreferrer');
}
