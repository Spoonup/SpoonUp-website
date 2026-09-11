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
    counterName: "Main Pickup Counter #1"
  },
  products: [
    {
      id: "prod-1",
      name: "Cold Brew Coffee",
      category: "Beverages",
      price: 120,
      description: "Slow-steeped artisanal cold coffee served with chilled ice.",
      imageUrl: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=400&q=80",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-2",
      name: "Special Masala Chai",
      category: "Beverages",
      price: 40,
      description: "Authentic hot spiced tea with cardamom, ginger, and aromatic spices.",
      imageUrl: "https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-3",
      name: "Crispy Paneer Wrap",
      category: "Food",
      price: 160,
      description: "Spiced paneer cubes, crunchy veggies & mint mayo rolled in a soft tortilla.",
      imageUrl: "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=400&q=80",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-4",
      name: "Signature Veg Burger",
      category: "Food",
      price: 140,
      description: "Crispy vegetable patty with melted cheese, lettuce, tomatoes, and tangy sauce.",
      imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=400&q=80",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-5",
      name: "Peri Peri French Fries",
      category: "Snacks",
      price: 90,
      description: "Golden crispy potato fries tossed in fiery peri-peri seasoning.",
      imageUrl: "https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=400&q=80",
      isAvailable: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "prod-6",
      name: "Rich Fudge Brownie",
      category: "Desserts",
      price: 110,
      description: "Decadent warm chocolate fudge brownie with chocolate drizzle.",
      imageUrl: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=400&q=80",
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
