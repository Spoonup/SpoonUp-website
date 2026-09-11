import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import {
  dbGetSettings,
  dbUpdateSettings,
  dbGetProducts,
  dbAddProduct,
  dbUpdateProduct,
  dbDeleteProduct,
  dbGetOrders,
  dbGetOrderById,
  dbCreateOrder,
  dbUpdateOrderStatus,
  generateOrderAccessToken
} from './db.js';
import { isSupabaseActive } from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// ----------------- SECURITY HEADERS -----------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ----------------- RATE LIMITING (Layer 02) -----------------
// Brute force protection on admin login: Max 5 attempts per 15 minutes per IP
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Order creation spam protection: Max 30 orders per 5 minutes per IP
const orderCreateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order rate limit reached. Please wait a few moments before placing another order.' }
});

// General API protection: Max 300 requests per minute
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', generalLimiter);

// ----------------- CRYPTOGRAPHIC PASSWORD HASHING (Layer 03) -----------------
/**
 * Hashes a password/PIN using cryptographic scrypt key derivation with a unique 16-byte salt.
 * Output format: "salt:derivedKeyHex"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password.trim(), salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a candidate password against a stored hash using timing-safe comparison.
 * Supports both modern scrypt salted hashes ("salt:key") and initial fallback hashes.
 */
function verifyPassword(candidate, storedHash) {
  if (typeof candidate !== 'string' || typeof storedHash !== 'string') return false;
  const trimmedCandidate = candidate.trim();
  const trimmedStored = storedHash.trim();

  // 1. Salted scrypt verification
  if (trimmedStored.includes(':')) {
    const [salt, keyHex] = trimmedStored.split(':');
    if (!salt || !keyHex) return false;
    try {
      const derivedKey = crypto.scryptSync(trimmedCandidate, salt, 64);
      const keyBuffer = Buffer.from(keyHex, 'hex');
      if (derivedKey.length !== keyBuffer.length) return false;
      return crypto.timingSafeEqual(derivedKey, keyBuffer);
    } catch {
      return false;
    }
  }

  // 2. Timing-safe fallback for initial plain/SHA hashes
  const hashInput = crypto.createHash('sha256').update(trimmedCandidate).digest();
  const hashTarget = crypto.createHash('sha256').update(trimmedStored).digest();
  return crypto.timingSafeEqual(hashInput, hashTarget);
}

function timingSafeCompare(input, target) {
  if (typeof input !== 'string' || typeof target !== 'string') return false;
  const hashInput = crypto.createHash('sha256').update(input.trim()).digest();
  const hashTarget = crypto.createHash('sha256').update(target.trim()).digest();
  return crypto.timingSafeEqual(hashInput, hashTarget);
}

// Mask sensitive phone numbers for public customer receipt display
function maskPhoneNumber(phone) {
  if (!phone || phone.length < 5) return '••••••';
  const visibleLast4 = phone.slice(-4);
  const countryPrefix = phone.startsWith('+') ? phone.slice(0, 3) + ' ' : '';
  return `${countryPrefix}••••••${visibleLast4}`;
}

// ----------------- AUTHENTICATION & AUTHORIZATION (Layer 05) -----------------
// Middleware: Authenticate Admin via PIN / Token
async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const pin = req.headers['x-admin-pin'] || (authHeader && authHeader.replace('Bearer ', ''));
  if (!pin) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }

  try {
    const settings = await dbGetSettings();
    const envPin = process.env.ADMIN_PIN || '1234';
    if (verifyPassword(String(pin), String(settings.adminPin)) || verifyPassword(String(pin), String(envPin))) {
      req.isAdmin = true;
      return next();
    }
    // Generic error (Layer 04)
    return res.status(401).json({ error: 'Unauthorized: Invalid credentials.' });
  } catch (err) {
    console.error('[Auth Error]', err);
    return res.status(401).json({ error: 'Unauthorized: Authentication failed.' });
  }
}

// Check admin credentials without throwing
async function checkIsAdmin(req) {
  const authHeader = req.headers.authorization;
  const pin = req.headers['x-admin-pin'] || (authHeader && authHeader.replace('Bearer ', ''));
  if (!pin) return false;
  try {
    const settings = await dbGetSettings();
    const envPin = process.env.ADMIN_PIN || '1234';
    return verifyPassword(String(pin), String(settings.adminPin)) || verifyPassword(String(pin), String(envPin));
  } catch {
    return false;
  }
}

// ----------------- PUBLIC SETTINGS -----------------
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbGetSettings();
    const isAdmin = await checkIsAdmin(req);

    res.json({
      eventName: settings.eventName,
      currencySymbol: settings.currencySymbol,
      counterName: settings.counterName,
      // Admin PIN is strictly hidden from regular customers (Layer 03/05)
      ...(isAdmin ? { adminPin: settings.adminPin } : {}),
      databaseType: isSupabaseActive() ? 'Supabase PostgreSQL' : 'Local SQLite/JSON'
    });
  } catch (err) {
    console.error('[Settings API Error]', err);
    res.status(500).json({ error: 'Failed to retrieve application settings.' });
  }
});

// Admin Login (Layer 02 Rate Limited + Layer 03 Password Verified + Layer 04 Generic Errors)
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string' || pin.trim().length === 0) {
    return res.status(400).json({ error: 'Please provide an admin PIN.' });
  }

  try {
    const settings = await dbGetSettings();
    const envPin = process.env.ADMIN_PIN || '1234';
    if (verifyPassword(pin, String(settings.adminPin)) || verifyPassword(pin, String(envPin))) {
      return res.json({
        success: true,
        token: pin.trim(),
        settings: {
          eventName: settings.eventName,
          currencySymbol: settings.currencySymbol,
          counterName: settings.counterName,
          databaseType: isSupabaseActive() ? 'Supabase PostgreSQL' : 'Local SQLite/JSON'
        }
      });
    }
    // Layer 04: Generic error message to prevent enumeration
    return res.status(401).json({ error: 'Invalid credentials.' });
  } catch (err) {
    console.error('[Admin Login Error]', err);
    return res.status(500).json({ error: 'Authentication service unavailable.' });
  }
});

app.put('/api/settings', authenticateAdmin, async (req, res) => {
  try {
    const { eventName, currencySymbol, adminPin, counterName } = req.body;
    const updates = {};
    if (eventName && typeof eventName === 'string') updates.eventName = eventName.slice(0, 100).trim();
    if (currencySymbol && typeof currencySymbol === 'string') updates.currencySymbol = currencySymbol.slice(0, 8).trim();
    
    // Layer 03: Store PIN as cryptographic salted hash
    if (adminPin && typeof adminPin === 'string' && adminPin.trim().length >= 4) {
      updates.adminPin = hashPassword(adminPin.trim().slice(0, 32));
    }
    if (counterName && typeof counterName === 'string') updates.counterName = counterName.slice(0, 100).trim();

    const updated = await dbUpdateSettings(updates);
    const { adminPin: _, ...publicSettings } = updated;
    res.json({ success: true, settings: publicSettings });
  } catch (err) {
    console.error('[Settings Update Error]', err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// ----------------- PRODUCTS (Layer 01 Validated + Protected) -----------------
app.get('/api/products', async (req, res) => {
  try {
    const products = await dbGetProducts();
    res.json(products);
  } catch (err) {
    console.error('[Get Products Error]', err);
    res.status(500).json({ error: 'Failed to retrieve menu products.' });
  }
});

app.post('/api/products', authenticateAdmin, async (req, res) => {
  try {
    const { name, category, price, description, imageUrl, isAvailable } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Valid product name is required.' });
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0 || numPrice > 100000) {
      return res.status(400).json({ error: 'Valid price (₹0 - ₹1,00,000) is required.' });
    }

    const newProduct = {
      id: `prod-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim().slice(0, 80),
      category: category ? String(category).trim().slice(0, 40) : 'General',
      price: numPrice,
      description: description ? String(description).trim().slice(0, 300) : '',
      imageUrl: imageUrl ? String(imageUrl).trim().slice(0, 500) : '',
      isAvailable: isAvailable !== false,
      createdAt: new Date().toISOString()
    };

    const saved = await dbAddProduct(newProduct);
    res.status(201).json(saved);
  } catch (err) {
    console.error('[Add Product Error]', err);
    res.status(500).json({ error: 'Failed to save new product.' });
  }
});

app.put('/api/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, description, imageUrl, isAvailable } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim().slice(0, 80);
    if (category !== undefined) updates.category = String(category).trim().slice(0, 40);
    if (price !== undefined) {
      const numPrice = Number(price);
      if (!isNaN(numPrice) && numPrice >= 0 && numPrice <= 100000) {
        updates.price = numPrice;
      }
    }
    if (description !== undefined) updates.description = String(description).trim().slice(0, 300);
    if (imageUrl !== undefined) updates.imageUrl = String(imageUrl).trim().slice(0, 500);
    if (isAvailable !== undefined) updates.isAvailable = Boolean(isAvailable);

    const updated = await dbUpdateProduct(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(updated);
  } catch (err) {
    console.error('[Update Product Error]', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

app.delete('/api/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await dbDeleteProduct(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    console.error('[Delete Product Error]', err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

// ----------------- ORDERS & ZERO-TRUST SECURITY (Layers 01, 04, 05) -----------------

// Admin: View all orders feed (Strictly Admin-authenticated)
app.get('/api/orders', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders();
    res.json(orders);
  } catch (err) {
    console.error('[Get Orders Error]', err);
    res.status(500).json({ error: 'Failed to retrieve orders.' });
  }
});

// Customer / Token-Authorized: Lookup single order with Zero-Trust protection
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await dbGetOrderById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // 1. Check if requester is Admin
    const isAdmin = await checkIsAdmin(req);
    if (isAdmin) {
      return res.json(order);
    }

    // 2. If not admin, verify unguessable secret access token
    const clientToken = req.headers['x-order-token'] || req.query.token;

    if (!clientToken || !timingSafeCompare(String(clientToken), String(order.accessToken))) {
      // Layer 04: Generic unauthorized message
      return res.status(403).json({
        error: 'Access Denied: You do not have permission to view this order. Valid authorization token required.'
      });
    }

    // 3. Customer verified with secret token: mask phone number for defense-in-depth
    const safeOrder = {
      ...order,
      customerPhone: maskPhoneNumber(order.customerPhone)
    };
    // Never expose raw internal accessToken in inspection response
    delete safeOrder.accessToken;

    res.json(safeOrder);
  } catch (err) {
    console.error('[Get Order By ID Error]', err);
    res.status(500).json({ error: 'Failed to retrieve order details.' });
  }
});

// Customer: Place Order (Layer 01 Server Validation + 256-bit unguessable accessToken)
app.post('/api/orders', orderCreateLimiter, async (req, res) => {
  try {
    const { customerName, customerPhone, items, notes } = req.body;

    // Layer 01: Strict Server-Side Input Validation
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2 || customerName.trim().length > 60) {
      return res.status(400).json({ error: 'Please enter a valid name (2-60 characters).' });
    }
    const cleanPhone = String(customerPhone || '').trim().replace(/[^\d+]/g, '');
    const digitsOnly = cleanPhone.replace(/\D/g, '');
    if (digitsOnly.length < 8 || digitsOnly.length > 18) {
      return res.status(400).json({ error: 'Please enter a valid phone number (8-18 digits).' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart cannot be empty.' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Order exceeds maximum item limit (50 items).' });
    }

    const products = await dbGetProducts();
    const productMap = new Map(products.map(p => [p.id, p]));

    let calculatedTotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      if (!item || !item.id) {
        return res.status(400).json({ error: 'Invalid cart item provided.' });
      }
      const prod = productMap.get(item.id);
      if (!prod) {
        return res.status(400).json({ error: `Selected item is not available on the current menu.` });
      }
      if (!prod.isAvailable) {
        return res.status(400).json({ error: `"${prod.name}" is currently sold out.` });
      }
      const qty = Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1));
      const subtotal = prod.price * qty;
      calculatedTotal += subtotal;

      verifiedItems.push({
        id: prod.id,
        name: prod.name,
        price: prod.price,
        quantity: qty,
        category: prod.category,
        imageUrl: prod.imageUrl,
        subtotal
      });
    }

    const settings = await dbGetSettings();
    const accessToken = generateOrderAccessToken();

    const newOrderData = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      customerName: customerName.trim().slice(0, 60),
      customerPhone: cleanPhone,
      items: verifiedItems,
      totalAmount: calculatedTotal,
      status: 'pending',
      notes: notes ? String(notes).trim().slice(0, 250) : '',
      counterName: settings.counterName || 'Main Shop',
      accessToken: accessToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const savedOrder = await dbCreateOrder(newOrderData);

    // Return order with accessToken only to the creator for their private tracker
    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('[Create Order Error]', err);
    res.status(500).json({ error: 'Failed to place order. Please try again.' });
  }
});

// Admin: Update order status (Strictly admin-only; customers cannot mutate status)
app.patch('/api/orders/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updated = await dbUpdateOrderStatus(id, status);
    if (!updated) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    res.json(updated);
  } catch (err) {
    console.error('[Update Order Status Error]', err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// ----------------- ANALYTICS & STATS -----------------
app.get('/api/stats', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders();
    const settings = await dbGetSettings();

    const totalOrders = orders.length;
    const activeOrders = orders.filter(o => o.status !== 'cancelled');
    const totalRevenue = activeOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const preparingCount = orders.filter(o => o.status === 'preparing').length;
    const readyCount = orders.filter(o => o.status === 'ready').length;
    const completedCount = orders.filter(o => o.status === 'completed').length;

    const itemCounts = {};
    orders.forEach(o => {
      if (o.status !== 'cancelled') {
        (o.items || []).forEach(item => {
          itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
        });
      }
    });

    const popularItems = Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      totalOrders,
      totalRevenue,
      pendingCount,
      preparingCount,
      readyCount,
      completedCount,
      popularItems,
      currencySymbol: settings.currencySymbol
    });
  } catch (err) {
    console.error('[Stats API Error]', err);
    res.status(500).json({ error: 'Failed to generate statistics.' });
  }
});

// Admin: CSV Export
app.get('/api/orders/export/csv', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders();

    let csv = 'Order Number,Date,Time,Customer Name,Phone,Items Summary,Total Amount,Status,Notes\n';
    orders.forEach(o => {
      const dateObj = new Date(o.createdAt);
      const dateStr = dateObj.toLocaleDateString();
      const timeStr = dateObj.toLocaleTimeString();
      const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join('; ');
      const safeName = `"${(o.customerName || '').replace(/"/g, '""')}"`;
      const safeNotes = `"${(o.notes || '').replace(/"/g, '""')}"`;
      const safeItems = `"${itemsSummary.replace(/"/g, '""')}"`;

      csv += `${o.orderNumber},${dateStr},${timeStr},${safeName},${o.customerPhone},${safeItems},${o.totalAmount},${o.status},${safeNotes}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=event_orders_${Date.now()}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('[CSV Export Error]', err);
    res.status(500).json({ error: 'Failed to export CSV report.' });
  }
});

// ----------------- STATIC ASSETS & FALLBACK -----------------
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('Event Order System Backend API is active.');
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT} (0.0.0.0)`);
});
