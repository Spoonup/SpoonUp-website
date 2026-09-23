import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { hashPassword, isHashedSecret, createUserSessionToken, USER_SESSION_TTL_MS } from './security.js';
import {
  isSupabaseActive,
  fetchSupabaseSettings,
  updateSupabaseSettings,
  fetchSupabaseProducts,
  insertSupabaseProduct,
  updateSupabaseProduct,
  deleteSupabaseProduct,
  fetchSupabaseOrders,
  fetchSupabaseOrderById,
  insertSupabaseOrder,
  updateSupabaseOrderStatus,
  updateSupabaseOrder,
  fetchSupabaseOrdersByUserId,
  insertSupabaseUser,
  fetchSupabaseUserByUsername,
  fetchSupabaseUserByEmail,
  fetchSupabaseUserById,
  insertSupabaseUserSession,
  fetchSupabaseUserSession,
  deleteSupabaseUserSession,
  insertSupabaseCheckout,
  fetchSupabaseCheckoutById,
  fetchSupabaseCheckoutByRazorpayOrderId,
  updateSupabaseCheckout,
  fetchSupabaseOrdersByRazorpayPaymentId,
  fetchSupabaseOrdersByIds,
  deleteExpiredSupabaseUserSessions,
  claimSupabaseCheckout
} from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DB_PATH);

const CREDENTIAL_PLACEHOLDER = 'CHANGE_ME';
const DEFAULT_ADMIN_USERNAME = 'admin';

function bootstrapAdminUsername() {
  return String(process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim();
}

const INITIAL_DATA = {
  settings: {
    eventName: "SpoonUp",
    currencySymbol: "₹",
    // adminUsername / adminPassword are filled by persistHashedAdminCredential on
    // first read, so no scrypt or credential generation happens at module load.
    counterName: "Main Shop",
    upiId: "",
    upiPhone: ""
  },
  products: [
    {
      id: "prod-1",
      name: "Pan Dry Fruit Gulkand Modak",
      category: "Healthy Sweets",
      price: 70,
      description: "Nutritious, delicious & guilt-free modak stuffed with aromatic pan, gulkand, and rich dry fruits. (Unit: Per Piece)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-1.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-2",
      name: "Chocolate Protein Chia Pudding",
      category: "Desserts",
      price: 425,
      description: "Decadent chocolate protein chia pudding with dark chocolate shavings. No Added Sugar. (Unit: Per Piece/Jar)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-2.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-3",
      name: "Dragonfruit Smoothie",
      category: "Beverages",
      price: 250,
      description: "Vibrant, antioxidant-rich dragonfruit smoothie with zero added sugar and chia seed topping. (Unit: Per Bottle)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-3.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-4",
      name: "Crispy Sabudana Sweet Potato Tikki with Chutney",
      category: "Snacks",
      price: 180,
      description: "Golden-crisp sabudana and sweet potato tikkis served with fresh coriander-mint chutney. (Unit: Per Plate)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-4.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-5",
      name: "Peri Peri Healthy House Fries with Special Sauce",
      category: "Snacks",
      price: 180,
      description: "Crispy house-cut healthy fries tossed in aromatic peri-peri spices with house special dip. (Unit: Per Plate)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-5.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-6",
      name: "Kashmiri Muesli",
      category: "Healthy Breakfast",
      price: 500,
      description: "Crunchy, tasty, snakable and great with milk. 100% natural, NO added sugar. (Unit: Per 100g)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-6.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-7",
      name: "Kashmir ke Almonds (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1500,
      description: "100% Pure premium Kashmiri Almonds (Badam Giri), rich in natural oils and sweetness. (Unit: Per kg)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-7.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-8",
      name: "Kashmir ke Cashews (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1800,
      description: "100% Pure jumbo Kashmiri Cashews (Kaju), naturally sweet, creamy, and crunchy. (Unit: Per kg)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-8.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-9",
      name: "Kashmir ke Walnuts (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1600,
      description: "100% Pure premium Kashmiri Walnut Kernels (Akhrot Giri), rich in Omega-3. (Unit: Per kg)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-9.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-10",
      name: "Kashmir ke Blackberries (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1400,
      description: "Sun-dried handpicked pure Kashmiri Blackberries / Berries, rich in natural antioxidants. (Unit: Per kg)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-10.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-11",
      name: "100% Pure Kashmiri Dry Fruits Assortment",
      category: "Kashmiri Dry Fruits",
      price: 1650,
      description: "Premium bowl assortment of Kashmiri Almonds, Cashews, Walnuts, and Blackberries. (Unit: Per 1 kg Bowl)",
      imageUrl: "https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-11.jpg",
      isAvailable: true,
      deliverLater: false,
      createdAt: new Date().toISOString()
    }
  ],
  orders: [],
  users: [],
  userSessions: [],
  checkouts: [],
  nextOrderNumber: 101
};

function normalizeDb(db) {
  db.settings = { upiId: '', upiPhone: '', ...(db.settings || {}) };
  // Local databases written by the old PIN scheme: drop the dead field so it can
  // never be mistaken for a live credential.
  delete db.settings.adminPin;
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.userSessions)) db.userSessions = [];
  if (!Array.isArray(db.checkouts)) db.checkouts = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.products)) db.products = [];
  db.products = db.products.map((p) => ({
    ...p,
    deliverLater: Boolean(p.deliverLater),
    gstRate: Number(p.gstRate ?? 5)
  }));
  db.orders = db.orders.map((order) => ({
    ...order,
    subtotalAmount: Number(order.subtotalAmount ?? order.totalAmount ?? 0),
    taxAmount: Number(order.taxAmount ?? 0)
  }));
  return db;
}

export function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    saveDb(INITIAL_DATA);
    return INITIAL_DATA;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return normalizeDb(JSON.parse(raw));
  } catch (err) {
    console.error("Error reading local database, restoring initial data:", err);
    saveDb(INITIAL_DATA);
    return INITIAL_DATA;
  }
}

export function saveDb(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_PATH);
}

/**
 * The stored admin password is hashed on first read. While it is still plaintext
 * (fresh install, or the `CHANGE_ME` schema placeholder) `ADMIN_PASSWORD` from the
 * environment wins, which is the supported way to bootstrap or reset the credential.
 * Once hashed, only the Settings screen can change it — the environment is not a
 * permanent second credential.
 *
 * Databases created under the old PIN scheme have no password yet; ADMIN_PASSWORD
 * must be supplied once to migrate them. The old `adminPin` value is never promoted
 * to a password, because a 6-digit PIN is not an acceptable password.
 */
async function persistHashedAdminCredential(settings) {
  if (!settings) return settings;

  const updates = {};
  if (!settings.adminUsername) {
    updates.adminUsername = bootstrapAdminUsername();
  }

  const storedPassword = settings.adminPassword ? String(settings.adminPassword) : '';
  const needsPassword = !storedPassword || storedPassword === CREDENTIAL_PLACEHOLDER;

  if (needsPassword && !process.env.ADMIN_PASSWORD) {
    // A real (Supabase) database must never invent its own credential silently.
    if (isSupabaseActive()) {
      const err = new Error(
        'Admin password is not set. Set ADMIN_PASSWORD once to bootstrap the staff login, then change it from Settings.'
      );
      err.status = 503;
      throw err;
    }
    // Local development: generate once and print it, so there is no default password.
    const generated = crypto.randomBytes(9).toString('base64url');
    console.warn(
      `⚠️ ADMIN_PASSWORD is not set. Generated a one-time staff password for this local database: ${generated}`
    );
    updates.adminPassword = await hashPassword(generated);
  } else if (needsPassword) {
    updates.adminPassword = await hashPassword(String(process.env.ADMIN_PASSWORD));
  } else if (!isHashedSecret(storedPassword)) {
    updates.adminPassword = await hashPassword(process.env.ADMIN_PASSWORD || storedPassword);
  }

  if (!Object.keys(updates).length) return settings;

  try {
    return await dbUpdateSettings(updates);
  } catch (err) {
    if (err.status) throw err;
    console.warn('Could not migrate admin credential to salted hash:', err.message);
    return settings;
  }
}

// Generates an unguessable 256-bit cryptographically secure secret access token
export function generateOrderAccessToken() {
  return `order_sec_${crypto.randomBytes(24).toString('hex')}`;
}

// ----------------- DUAL-MODE REPOSITORY LAYER -----------------

// Settings
export async function dbGetSettings() {
  if (isSupabaseActive()) {
    return persistHashedAdminCredential(await fetchSupabaseSettings());
  }
  const local = getDb();
  return persistHashedAdminCredential(local.settings);
}

export async function dbUpdateSettings(updates) {
  if (isSupabaseActive()) {
    return await updateSupabaseSettings(updates);
  }
  const db = getDb();
  if (updates.eventName) db.settings.eventName = updates.eventName.trim();
  if (updates.currencySymbol) db.settings.currencySymbol = updates.currencySymbol.trim();
  if (updates.adminUsername) db.settings.adminUsername = updates.adminUsername.trim();
  if (updates.adminPassword) db.settings.adminPassword = updates.adminPassword.trim();
  if (updates.counterName) db.settings.counterName = updates.counterName.trim();
  if (updates.upiId !== undefined) db.settings.upiId = String(updates.upiId).trim();
  if (updates.upiPhone !== undefined) db.settings.upiPhone = String(updates.upiPhone).trim();
  saveDb(db);
  return db.settings;
}

// Products
export async function dbGetProducts() {
  if (isSupabaseActive()) {
    return await fetchSupabaseProducts();
  }
  const db = getDb();
  return db.products || [];
}

export async function dbAddProduct(product) {
  if (isSupabaseActive()) {
    return await insertSupabaseProduct(product);
  }
  const db = getDb();
  db.products.push(product);
  saveDb(db);
  return product;
}

export async function dbUpdateProduct(id, updates) {
  if (isSupabaseActive()) {
    return await updateSupabaseProduct(id, updates);
  }
  const db = getDb();
  const idx = db.products.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const prod = db.products[idx];
  if (updates.name !== undefined) prod.name = updates.name.trim();
  if (updates.category !== undefined) prod.category = updates.category.trim();
  if (updates.price !== undefined && !isNaN(Number(updates.price))) prod.price = Math.max(0, Number(updates.price));
  if (updates.description !== undefined) prod.description = updates.description.trim();
  if (updates.imageUrl !== undefined) prod.imageUrl = updates.imageUrl.trim();
  if (updates.isAvailable !== undefined) prod.isAvailable = Boolean(updates.isAvailable);
  if (updates.deliverLater !== undefined) prod.deliverLater = Boolean(updates.deliverLater);
  if (updates.gstRate !== undefined) prod.gstRate = Number(updates.gstRate);
  prod.updatedAt = new Date().toISOString();
  db.products[idx] = prod;
  saveDb(db);
  return prod;
}

export async function dbDeleteProduct(id) {
  if (isSupabaseActive()) {
    return await deleteSupabaseProduct(id);
  }
  const db = getDb();
  const initLen = db.products.length;
  db.products = db.products.filter(p => p.id !== id);
  if (db.products.length === initLen) return false;
  saveDb(db);
  return true;
}

// Orders
export const DEFAULT_ORDER_LIMIT = 500;
export const MAX_ORDER_LIMIT = 1000;

/**
 * Newest-first order list. `limit` caps the rows returned (admin screens poll this
 * every few seconds, so it must not grow with the lifetime of the shop) and `since`
 * (ISO timestamp) returns only orders updated at or after that instant.
 */
export async function dbGetOrders({ limit = DEFAULT_ORDER_LIMIT, since = null } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_ORDER_LIMIT, Number(limit) || DEFAULT_ORDER_LIMIT));
  if (isSupabaseActive()) {
    return await fetchSupabaseOrders({ limit: safeLimit, since });
  }
  const db = getDb();
  const sinceMs = since ? new Date(since).getTime() : 0;
  return [...(db.orders || [])]
    .filter(o => !sinceMs || new Date(o.updatedAt || o.createdAt).getTime() >= sinceMs)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, safeLimit);
}

export async function dbGetOrdersByIds(ids) {
  const wanted = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!wanted.length) return [];
  if (isSupabaseActive()) {
    return await fetchSupabaseOrdersByIds(wanted);
  }
  const db = getDb();
  return (db.orders || []).filter(o => wanted.includes(o.id));
}

export async function dbGetOrderById(id) {
  if (isSupabaseActive()) {
    return await fetchSupabaseOrderById(id);
  }
  const db = getDb();
  // Lookup by UUID id or token or orderNumber
  return db.orders.find(o => o.id === id || String(o.orderNumber) === String(id)) || null;
}

export async function dbCreateOrder(orderData) {
  if (isSupabaseActive()) {
    return await insertSupabaseOrder(orderData);
  }
  const db = getDb();
  const orderNumber = db.nextOrderNumber || 101;
  db.nextOrderNumber = orderNumber + 1;
  const order = {
    ...orderData,
    orderNumber
  };
  db.orders.push(order);
  saveDb(db);
  return order;
}

export async function dbUpdateOrderStatus(id, status) {
  if (isSupabaseActive()) {
    return await updateSupabaseOrderStatus(id, status);
  }
  const db = getDb();
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  db.orders[idx].status = status;
  if (status === 'refunded') db.orders[idx].paymentStatus = 'refunded';
  if (status === 'preparing' && db.orders[idx].paymentMethod === 'counter') {
    db.orders[idx].paymentStatus = 'paid';
  }
  db.orders[idx].updatedAt = new Date().toISOString();
  saveDb(db);
  return db.orders[idx];
}

export async function dbUpdateOrder(id, updates) {
  if (isSupabaseActive()) {
    return await updateSupabaseOrder(id, updates);
  }
  const db = getDb();
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  const order = db.orders[idx];
  if (updates.status !== undefined) order.status = updates.status;
  if (updates.paymentStatus !== undefined) order.paymentStatus = updates.paymentStatus;
  if (updates.trackingLink !== undefined) order.trackingLink = updates.trackingLink;
  if (updates.deliveryAddress !== undefined) order.deliveryAddress = updates.deliveryAddress;
  order.updatedAt = new Date().toISOString();
  db.orders[idx] = order;
  saveDb(db);
  return order;
}

export async function dbGetOrdersByUserId(userId) {
  if (isSupabaseActive()) {
    return await fetchSupabaseOrdersByUserId(userId);
  }
  const db = getDb();
  return (db.orders || [])
    .filter(o => o.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt
  };
}

export async function dbCreateUser(user) {
  if (isSupabaseActive()) {
    return await insertSupabaseUser(user);
  }
  const db = getDb();
  db.users.push(user);
  saveDb(db);
  return user;
}

export async function dbGetUserByUsername(username) {
  const needle = String(username || '').trim().toLowerCase();
  if (isSupabaseActive()) {
    return await fetchSupabaseUserByUsername(needle);
  }
  const db = getDb();
  return db.users.find(u => String(u.username).toLowerCase() === needle) || null;
}

export async function dbGetUserByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (isSupabaseActive()) {
    return await fetchSupabaseUserByEmail(needle);
  }
  const db = getDb();
  return db.users.find(u => String(u.email).toLowerCase() === needle) || null;
}

export async function dbGetUserById(id) {
  if (isSupabaseActive()) {
    return await fetchSupabaseUserById(id);
  }
  const db = getDb();
  return db.users.find(u => u.id === id) || null;
}

export async function dbCreateUserSession(userId) {
  const session = {
    token: createUserSessionToken(),
    userId,
    expiresAt: new Date(Date.now() + USER_SESSION_TTL_MS).toISOString()
  };
  if (isSupabaseActive()) {
    await insertSupabaseUserSession(session);
    return session;
  }
  const db = getDb();
  db.userSessions.push(session);
  saveDb(db);
  return session;
}

export async function dbGetUserBySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('usr_')) return null;
  let session = null;
  if (isSupabaseActive()) {
    session = await fetchSupabaseUserSession(token);
  } else {
    const db = getDb();
    session = db.userSessions.find(s => s.token === token) || null;
  }
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await dbDeleteUserSession(token);
    return null;
  }
  return dbGetUserById(session.userId);
}

// Called on login so expired rows never accumulate indefinitely.
export async function dbDeleteExpiredUserSessions() {
  const now = new Date().toISOString();
  if (isSupabaseActive()) {
    return await deleteExpiredSupabaseUserSessions(now);
  }
  const db = getDb();
  const before = db.userSessions.length;
  db.userSessions = db.userSessions.filter(s => s.expiresAt >= now);
  if (db.userSessions.length !== before) saveDb(db);
  return before - db.userSessions.length;
}

export async function dbDeleteUserSession(token) {
  if (isSupabaseActive()) {
    return await deleteSupabaseUserSession(token);
  }
  const db = getDb();
  db.userSessions = db.userSessions.filter(s => s.token !== token);
  saveDb(db);
  return true;
}

export async function dbCreateCheckout(checkout) {
  if (isSupabaseActive()) {
    return await insertSupabaseCheckout(checkout);
  }
  const db = getDb();
  db.checkouts.push(checkout);
  saveDb(db);
  return checkout;
}

export async function dbGetCheckoutById(id) {
  if (isSupabaseActive()) {
    return await fetchSupabaseCheckoutById(id);
  }
  const db = getDb();
  return db.checkouts.find(c => c.id === id) || null;
}

export async function dbGetCheckoutByRazorpayOrderId(razorpayOrderId) {
  const orderId = String(razorpayOrderId || '').trim();
  if (!orderId) return null;
  if (isSupabaseActive()) {
    return await fetchSupabaseCheckoutByRazorpayOrderId(orderId);
  }
  const db = getDb();
  return db.checkouts.find(c => c.razorpayOrderId === orderId) || null;
}

export async function dbGetOrdersByRazorpayPaymentId(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return [];
  if (isSupabaseActive()) {
    return await fetchSupabaseOrdersByRazorpayPaymentId(id);
  }
  const db = getDb();
  return (db.orders || []).filter(o => o.razorpayPaymentId === id);
}

/**
 * Atomically moves a checkout from one of `fromStatuses` to `toStatus`.
 * Returns the claimed checkout, or null when another worker already claimed it.
 * This is the lock that stops the webhook and the client from both fulfilling
 * the same payment.
 */
export async function dbClaimCheckout(id, fromStatuses, toStatus) {
  if (isSupabaseActive()) {
    return await claimSupabaseCheckout(id, fromStatuses, toStatus);
  }
  const db = getDb();
  const idx = db.checkouts.findIndex(c => c.id === id);
  if (idx === -1 || !fromStatuses.includes(db.checkouts[idx].status)) return null;
  db.checkouts[idx] = { ...db.checkouts[idx], status: toStatus, updatedAt: new Date().toISOString() };
  saveDb(db);
  return db.checkouts[idx];
}

export async function dbUpdateCheckout(id, updates) {
  if (isSupabaseActive()) {
    return await updateSupabaseCheckout(id, updates);
  }
  const db = getDb();
  const idx = db.checkouts.findIndex(c => c.id === id);
  if (idx === -1) return null;
  db.checkouts[idx] = {
    ...db.checkouts[idx],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  saveDb(db);
  return db.checkouts[idx];
}
