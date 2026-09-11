import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
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
  updateSupabaseOrderStatus
} from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const INITIAL_DATA = {
  settings: {
    eventName: "SpoonUp",
    currencySymbol: "₹",
    adminPin: process.env.ADMIN_PIN || "1234",
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
      createdAt: new Date().toISOString()
    }
  ],
  orders: [],
  nextOrderNumber: 101
};

export function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    saveDb(INITIAL_DATA);
    return INITIAL_DATA;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading local database, restoring initial data:", err);
    saveDb(INITIAL_DATA);
    return INITIAL_DATA;
  }
}

export function saveDb(data) {
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_PATH);
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
    if (s) return s;
  }
  const local = getDb();
  return local.settings;
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
  db.orders[idx].updatedAt = new Date().toISOString();
  saveDb(db);
  return db.orders[idx];
}
