/**
 * Thin API layer over the existing backend.
 *
 * What the backend actually models today:
 *   products  → id, name, category, price, description, imageUrl, isAvailable,
 *               deliverLater, gstRate
 *   orders    → one order per fulfilmentType ('immediate' | 'delivery'), split from
 *               a single checkout and linked by paymentGroupId
 *   auth      → customer username + password (NOT phone OTP)
 *   checkout  → prepare + complete, paymentMethod 'counter' | 'online'
 *
 * What it does NOT model, and is therefore still mocked in the UI:
 *   subscriptions / plans, the wallet (plan balance + spendable credit),
 *   referrals, coupons, and the design's three-way kitchen/plan/pantry split
 *   (the backend has a two-way immediate/delivery boolean).
 */

export const USER_TOKEN_KEY = 'user_session';
export const ORDER_TOKENS_KEY = 'order_tokens';
export const MY_ORDERS_KEY = 'my_orders';

export function getUserToken() {
  try {
    return localStorage.getItem(USER_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setUserToken(token) {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

/** Order access tokens are the only way to read a guest order back (anti-IDOR). */
export function rememberOrders(orders) {
  const stored = readJson(MY_ORDERS_KEY, []);
  const tokens = readJson(ORDER_TOKENS_KEY, {});
  for (const order of orders) {
    stored.unshift(order);
    if (order.accessToken) {
      tokens[order.id] = order.accessToken;
      tokens[String(order.orderNumber)] = order.accessToken;
    }
  }
  writeJson(MY_ORDERS_KEY, stored.slice(0, 40));
  writeJson(ORDER_TOKENS_KEY, tokens);
}

export function getOrderToken(id) {
  return readJson(ORDER_TOKENS_KEY, {})[String(id)] || '';
}

export function getRememberedOrders() {
  return readJson(MY_ORDERS_KEY, []);
}

async function request(path, { method = 'GET', body, token, orderToken } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const userToken = token ?? getUserToken();
  if (userToken) headers['x-user-token'] = userToken;
  if (orderToken) headers['x-order-token'] = orderToken;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/**
 * Adapts a backend product to the shape the design expects.
 * The backend's `deliverLater` boolean is the only fulfilment signal it has, so it
 * maps onto kitchen vs pantry; `plan` has no backend equivalent yet.
 */
export function adaptProduct(p) {
  const type = p.deliverLater ? 'pantry' : 'kitchen';
  return {
    id: p.id,
    name: p.name,
    type,
    image: p.imageUrl || '/assets/products/chia.png',
    price: Number(p.price) || 0,
    meta: p.description || p.category || '',
    badge: type === 'pantry' ? 'SHIPS · 3–5 DAYS' : 'NOW · 30 MIN',
    shippingNote: type === 'pantry' ? 'Free shipping over ₹999' : undefined,
    // TODO: Handle core functionality later — the backend has no subscription flag.
    subscribable: false,
    isAvailable: p.isAvailable !== false,
    gstRate: Number(p.gstRate ?? 5),
    tags: []
  };
}

export const api = {
  settings: () => request('/api/settings'),

  products: async () => {
    const rows = await request('/api/products');
    return rows.filter((p) => p.isAvailable !== false).map(adaptProduct);
  },

  signup: (payload) => request('/api/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST' }).catch(() => ({})),
  me: () => request('/api/auth/me'),
  myOrders: () => request('/api/me/orders'),

  order: (id) => request(`/api/orders/${id}`, { orderToken: getOrderToken(id) }),

  /**
   * Places a real order. Only kitchen and pantry lines can be sent — the backend
   * has no subscription concept, so plans are excluded by the caller.
   */
  prepareCheckout: (payload) => request('/api/checkout/prepare', { method: 'POST', body: payload }),
  completeCheckout: (payload) => request('/api/checkout/complete', { method: 'POST', body: payload })
};
