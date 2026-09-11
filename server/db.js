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
  updateSupabaseCheckout
} from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DB_PATH);

const INITIAL_DATA = {
  settings: {
    eventName: "SpoonUp",
    currencySymbol: "₹",
    adminPin: hashPassword(process.env.ADMIN_PIN || "1234"),
    counterName: "Main Shop"
  },
  products: [
    {
      id: "prod-1",
      name: "Pan Dry Fruit Gulkand Modak",
      category: "Healthy Sweets",
      price: 70,
      description: "Nutritious, delicious & guilt-free modak stuffed with aromatic pan, gulkand, and rich dry fruits. (Unit: Per Piece)",
      imageUrl: "/images/menu/modak.jpg",
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
      imageUrl: "/images/menu/chia_pudding.jpg",
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
      imageUrl: "/images/menu/dragonfruit_smoothie.jpg",
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
      imageUrl: "/images/menu/sabudana_tikki.jpg",
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
      imageUrl: "/images/menu/peri_peri_fries.jpg",
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
      imageUrl: "/images/menu/muesli.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-7",
      name: "Kashmir ke Almonds (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1500,
      description: "100% Pure premium Kashmiri Almonds (Badam Giri), rich in natural oils and sweetness. (Unit: Per kg)",
      imageUrl: "/images/menu/almonds.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-8",
      name: "Kashmir ke Cashews (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1800,
      description: "100% Pure jumbo Kashmiri Cashews (Kaju), naturally sweet, creamy, and crunchy. (Unit: Per kg)",
      imageUrl: "/images/menu/cashews.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-9",
      name: "Kashmir ke Walnuts (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1600,
      description: "100% Pure premium Kashmiri Walnut Kernels (Akhrot Giri), rich in Omega-3. (Unit: Per kg)",
      imageUrl: "/images/menu/walnuts.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-10",
      name: "Kashmir ke Blackberries (100% Pure)",
      category: "Kashmiri Dry Fruits",
      price: 1400,
      description: "Sun-dried handpicked pure Kashmiri Blackberries / Berries, rich in natural antioxidants. (Unit: Per kg)",
      imageUrl: "/images/menu/blackberries.jpg",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-11",
      name: "100% Pure Kashmiri Dry Fruits Assortment",
      category: "Kashmiri Dry Fruits",
      price: 1650,
      description: "Premium bowl assortment of Kashmiri Almonds, Cashews, Walnuts, and Blackberries. (Unit: Per 1 kg Bowl)",
      imageUrl: "/images/menu/dry_fruits.jpg",
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
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.userSessions)) db.userSessions = [];
  if (!Array.isArray(db.checkouts)) db.checkouts = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.products)) db.products = [];
  db.products = db.products.map((p) => ({
    ...p,
    deliverLater: Boolean(p.deliverLater)
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
 * The stored PIN is hashed on first read. While it is still plaintext (fresh install,
 * or the `CHANGE_ME` schema placeholder) an `ADMIN_PIN` from the environment wins, which
 * is the supported way to bootstrap or reset the staff PIN. Once hashed, only the
 * Settings screen can change it — the environment is not a permanent second credential.
 */
async function persistHashedPinIfNeeded(settings) {
  if (!settings?.adminPin || isHashedSecret(settings.adminPin)) {
    return settings;
  }
  const bootstrapPin = process.env.ADMIN_PIN || String(settings.adminPin);
  try {
    return await dbUpdateSettings({ adminPin: hashPassword(bootstrapPin) });
  } catch (err) {
    console.warn('Could not migrate admin PIN to salted hash:', err.message);
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
    const s = await fetchSupabaseSettings();
    if (s) return persistHashedPinIfNeeded(s);
  }
  const local = getDb();
  return persistHashedPinIfNeeded(local.settings);
}

export async function dbUpdateSettings(updates) {
  if (isSupabaseActive()) {
    const s = await updateSupabaseSettings(updates);
    if (s) return s;
  }
  const db = getDb();
  if (updates.eventName) db.settings.eventName = updates.eventName.trim();
  if (updates.currencySymbol) db.settings.currencySymbol = updates.currencySymbol.trim();
  if (updates.adminPin) db.settings.adminPin = updates.adminPin.trim();
  if (updates.counterName) db.settings.counterName = updates.counterName.trim();
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
export async function dbGetOrders() {
  if (isSupabaseActive()) {
    return await fetchSupabaseOrders();
  }
  const db = getDb();
  return [...(db.orders || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
