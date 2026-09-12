import dotenv from 'dotenv';
dotenv.config({ override: false });

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
  dbUpdateOrder,
  dbGetOrdersByUserId,
  dbCreateUser,
  dbGetUserByUsername,
  dbGetUserByEmail,
  dbCreateUserSession,
  dbGetUserBySessionToken,
  dbDeleteUserSession,
  dbCreateCheckout,
  dbGetCheckoutById,
  dbUpdateCheckout,
  publicUser
} from './db.js';
import { isSupabaseActive } from './supabase.js';
import {
  hashPassword,
  verifyPassword,
  timingSafeCompare,
  createAdminSession,
  isValidAdminSession,
  sanitizeImageUrl,
  sanitizeTrackingUrl,
  csvCell,
  isValidUsername,
  isValidEmail
} from './security.js';
import {
  isRazorpayConfigured,
  getRazorpayKeyId,
  createRazorpayOrder,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
  isRazorpayWebhookConfigured
} from './razorpay.js';
import {
  cleanPhoneNumber,
  isValidPhone,
  normalizeDeliveryAddress,
  verifyCartItems,
  cartNeedsDeliveryAddress,
  createSplitOrders,
  fulfillPaidCheckout
} from './checkout.js';
import { handleRazorpayWebhookEvent } from './webhooks.js';
import { normalizeGstRate } from './tax.js';
import {
  isManagedProductImageUrl,
  isProductImageStorageConfigured,
  uploadProductImage
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ----------------- SECURITY HEADERS -----------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.razorpay.com https://api.razorpay.com; frame-ancestors 'none'"
  );
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      try {
        if (new URL(origin).host === req.headers.host) {
          return callback(null, true);
        }
      } catch {
        // ignore malformed Origin
      }
      return callback(null, !isProduction);
    }
  })(req, res, next);
});

app.use((req, res, next) => {
  const requestPath = req.originalUrl.split('?')[0];
  if (requestPath === '/api/webhooks/razorpay') {
    return express.raw({ type: '*/*', limit: '256kb' })(req, res, next);
  }
  if (requestPath === '/api/products/images' && req.method === 'POST') {
    return express.raw({ type: 'image/*', limit: '5mb' })(req, res, next);
  }
  return express.json({ limit: '64kb' })(req, res, next);
});

// ----------------- RATE LIMITING (Layer 02) -----------------
// Brute force protection on admin login: Max 5 attempts per 15 minutes per IP
const userAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

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
  legacyHeaders: false,
  skip: (req) => req.originalUrl.split('?')[0] === '/api/webhooks/razorpay'
});
app.use('/api', generalLimiter);

function publicOrder(order) {
  if (!order) return order;
  const { accessToken: _accessToken, ...safe } = order;
  return safe;
}

function getUserCredential(req) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return req.headers['x-user-token'] || (bearer.startsWith('usr_') ? bearer : '');
}

async function getUserFromRequest(req) {
  const token = String(getUserCredential(req) || '').trim();
  if (!token) return null;
  try {
    return await dbGetUserBySessionToken(token);
  } catch {
    return null;
  }
}

async function authenticateUser(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  req.user = user;
  next();
}

function getAdminCredential(req) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return req.headers['x-admin-pin'] || bearer || '';
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
  const credential = String(getAdminCredential(req) || '').trim();
  if (!credential || credential.length > 128) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }

  try {
    if (isValidAdminSession(credential)) {
      req.isAdmin = true;
      return next();
    }
    if (credential.length >= 4 && credential.length <= 32) {
      const settings = await dbGetSettings();
      if (verifyPassword(credential, String(settings.adminPin))) {
        req.isAdmin = true;
        return next();
      }
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid credentials.' });
  } catch (err) {
    console.error('[Auth Error]', err);
    return res.status(401).json({ error: 'Unauthorized: Authentication failed.' });
  }
}

async function checkIsAdmin(req) {
  const credential = String(getAdminCredential(req) || '').trim();
  if (!credential || credential.length > 128) return false;
  try {
    if (isValidAdminSession(credential)) return true;
    if (credential.length < 4 || credential.length > 32) return false;
    const settings = await dbGetSettings();
    return verifyPassword(credential, String(settings.adminPin));
  } catch {
    return false;
  }
}

// ----------------- PUBLIC SETTINGS -----------------
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbGetSettings();

    // The stored PIN hash is never returned, not even to an authenticated admin.
    res.json({
      eventName: settings.eventName,
      currencySymbol: settings.currencySymbol,
      counterName: settings.counterName,
      databaseType: isSupabaseActive() ? 'Supabase PostgreSQL' : 'Local JSON',
      razorpayEnabled: isRazorpayConfigured(),
      razorpayKeyId: isRazorpayConfigured() ? getRazorpayKeyId() : ''
    });
  } catch (err) {
    console.error('[Settings API Error]', err);
    res.status(500).json({ error: 'Failed to retrieve application settings.' });
  }
});

// Admin Login (Layer 02 Rate Limited + Layer 03 Password Verified + Layer 04 Generic Errors)
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string' || pin.trim().length < 4 || pin.trim().length > 32) {
    return res.status(400).json({ error: 'Please provide an admin PIN.' });
  }

  try {
    const settings = await dbGetSettings();
    if (verifyPassword(pin, String(settings.adminPin))) {
      const sessionToken = createAdminSession();
      return res.json({
        success: true,
        token: sessionToken,
        settings: {
          eventName: settings.eventName,
          currencySymbol: settings.currencySymbol,
          counterName: settings.counterName,
          databaseType: isSupabaseActive() ? 'Supabase PostgreSQL' : 'Local JSON',
          razorpayEnabled: isRazorpayConfigured(),
          razorpayKeyId: isRazorpayConfigured() ? getRazorpayKeyId() : ''
        }
      });
    }
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
    const { name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Valid product name is required.' });
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0 || numPrice > 100000) {
      return res.status(400).json({ error: 'Valid price (₹0 - ₹1,00,000) is required.' });
    }
    if (isProductImageStorageConfigured() && !isManagedProductImageUrl(imageUrl)) {
      return res.status(400).json({ error: 'Please upload the product image to Cloud Storage.' });
    }

    const newProduct = {
      id: `prod-${crypto.randomUUID()}`,
      name: name.trim().slice(0, 80),
      category: category ? String(category).trim().slice(0, 40) : 'General',
      price: numPrice,
      description: description ? String(description).trim().slice(0, 300) : '',
      imageUrl: sanitizeImageUrl(imageUrl),
      isAvailable: isAvailable !== false,
      deliverLater: Boolean(deliverLater),
      gstRate: normalizeGstRate(gstRate),
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
    const { name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate } = req.body;
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
    if (imageUrl !== undefined) {
      if (isProductImageStorageConfigured() && !isManagedProductImageUrl(imageUrl)) {
        return res.status(400).json({ error: 'Please upload the product image to Cloud Storage.' });
      }
      updates.imageUrl = sanitizeImageUrl(imageUrl);
    }
    if (isAvailable !== undefined) updates.isAvailable = Boolean(isAvailable);
    if (deliverLater !== undefined) updates.deliverLater = Boolean(deliverLater);
    if (gstRate !== undefined) updates.gstRate = normalizeGstRate(gstRate);

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

app.post('/api/products/images', authenticateAdmin, async (req, res) => {
  try {
    const imageUrl = await uploadProductImage(req.body, {
      contentType: String(req.headers['content-type'] || '').split(';')[0].trim(),
      filename: String(req.headers['x-file-name'] || '')
    });
    res.status(201).json({ imageUrl });
  } catch (err) {
    console.error('[Product Image Upload Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to upload product image.' });
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

// ----------------- CUSTOMER AUTH -----------------
app.post('/api/auth/signup', userAuthLimiter, async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3-32 letters, numbers, or underscores.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be 8-72 characters.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number (8-18 digits).' });
    }

    const uname = String(username).trim();
    const mail = String(email).trim().toLowerCase();
    const { cleanPhone } = cleanPhoneNumber(phone);

    if (await dbGetUserByUsername(uname)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    if (await dbGetUserByEmail(mail)) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    const user = await dbCreateUser({
      id: `user-${crypto.randomUUID()}`,
      username: uname,
      passwordHash: hashPassword(password),
      email: mail,
      phone: cleanPhone,
      createdAt: new Date().toISOString()
    });
    const session = await dbCreateUserSession(user.id);
    res.status(201).json({ success: true, token: session.token, user: publicUser(user) });
  } catch (err) {
    console.error('[Signup Error]', err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', userAuthLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const user = await dbGetUserByUsername(username);
    if (!user || !verifyPassword(String(password), String(user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const session = await dbCreateUserSession(user.id);
    res.json({ success: true, token: session.token, user: publicUser(user) });
  } catch (err) {
    console.error('[User Login Error]', err);
    res.status(500).json({ error: 'Authentication service unavailable.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = String(getUserCredential(req) || '').trim();
  if (token) await dbDeleteUserSession(token);
  res.json({ success: true });
});

app.get('/api/auth/me', authenticateUser, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/me/orders', authenticateUser, async (req, res) => {
  try {
    const orders = await dbGetOrdersByUserId(req.user.id);
    res.json(orders.map((order) => ({
      ...publicOrder(order),
      customerPhone: maskPhoneNumber(order.customerPhone)
    })));
  } catch (err) {
    console.error('[My Orders Error]', err);
    res.status(500).json({ error: 'Failed to retrieve your orders.' });
  }
});

function checkoutCustomerFields(body, user) {
  const nameFromUser = user?.username || '';
  const customerName = String(body.customerName || nameFromUser || '').trim();
  const phoneSource = body.customerPhone || user?.phone || '';
  const { cleanPhone, digitsOnly } = cleanPhoneNumber(phoneSource);
  return { customerName, cleanPhone, digitsOnly };
}

// ----------------- CHECKOUT & RAZORPAY -----------------
app.post('/api/checkout/prepare', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { items, notes, paymentMethod } = req.body;
    const method = paymentMethod === 'online' ? 'online' : 'counter';
    const { customerName, cleanPhone, digitsOnly } = checkoutCustomerFields(req.body, user);

    if (!customerName || customerName.length < 2 || customerName.length > 60) {
      return res.status(400).json({ error: 'Please enter a valid name (2-60 characters).' });
    }
    if (!user && digitsOnly.length < 8) {
      return res.status(400).json({ error: 'Phone number is required for guest checkout.' });
    }
    if (digitsOnly.length < 8 || digitsOnly.length > 18) {
      return res.status(400).json({ error: 'Please enter a valid phone number (8-18 digits).' });
    }
    if (method === 'online' && !isRazorpayConfigured()) {
      if (process.env.NODE_ENV !== 'test') {
        return res.status(503).json({ error: 'Online payments are not configured yet. Please pay at the counter.' });
      }
    }

    const {
      verifiedItems,
      calculatedSubtotal,
      calculatedTax,
      calculatedTotal
    } = await verifyCartItems(items);
    const needsDeliveryAddress = cartNeedsDeliveryAddress(verifiedItems);
    const checkoutId = `chk-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    let razorpayOrderId = '';

    if (method === 'online') {
      if (isRazorpayConfigured()) {
        const rzp = await createRazorpayOrder({
          amountPaise: Math.round(calculatedTotal * 100),
          receipt: checkoutId.replace(/-/g, '').slice(0, 40),
          notes: { checkoutId }
        });
        razorpayOrderId = rzp.id;
      } else {
        razorpayOrderId = `order_test_${checkoutId.replace(/-/g, '').slice(0, 14)}`;
      }
    }

    await dbCreateCheckout({
      id: checkoutId,
      userId: user?.id || null,
      customerName: customerName.slice(0, 60),
      customerPhone: cleanPhone,
      items: verifiedItems,
      notes: notes ? String(notes).trim().slice(0, 250) : '',
      paymentMethod: method,
      subtotalAmount: calculatedSubtotal,
      taxAmount: calculatedTax,
      amount: calculatedTotal,
      status: 'open',
      razorpayOrderId,
      razorpayPaymentId: '',
      deliveryAddress: null,
      createdOrders: [],
      createdAt: now,
      updatedAt: now
    });

    res.json({
      checkoutId,
      subtotalAmount: calculatedSubtotal,
      taxAmount: calculatedTax,
      amount: calculatedTotal,
      paymentMethod: method,
      needsDeliveryAddress,
      razorpayKeyId: method === 'online' ? getRazorpayKeyId() : '',
      razorpayOrderId
    });
  } catch (err) {
    console.error('[Checkout Prepare Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Could not start checkout.' });
  }
});

app.post('/api/checkout/complete', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const {
      checkoutId,
      deliveryAddress,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature
    } = req.body;

    const checkout = await dbGetCheckoutById(String(checkoutId || '').trim());
    if (!checkout || checkout.status === 'cancelled') {
      return res.status(404).json({ error: 'Checkout session not found.' });
    }
    if (checkout.status === 'failed') {
      return res.status(400).json({ error: 'Payment failed. Please try checkout again.' });
    }
    if (checkout.status === 'completed' && Array.isArray(checkout.createdOrders) && checkout.createdOrders.length) {
      return res.json({ orders: checkout.createdOrders, alreadyCompleted: true });
    }

    const address = cartNeedsDeliveryAddress(checkout.items)
      ? normalizeDeliveryAddress(deliveryAddress)
      : null;
    if (cartNeedsDeliveryAddress(checkout.items) && !address) {
      return res.status(400).json({
        error: 'Please provide a delivery address for deliver-later items.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

    const webhookPaid = ['paid', 'completed'].includes(checkout.status) && Boolean(checkout.razorpayPaymentId);
    let paymentId = checkout.razorpayPaymentId || '';
    if (checkout.paymentMethod === 'online' && !webhookPaid) {
      const valid = verifyRazorpaySignature({
        orderId: razorpayOrderId || checkout.razorpayOrderId,
        paymentId: razorpayPaymentId,
        signature: razorpaySignature
      });
      if (!valid || (checkout.razorpayOrderId && razorpayOrderId && checkout.razorpayOrderId !== razorpayOrderId)) {
        return res.status(400).json({ error: 'Payment verification failed.' });
      }
      paymentId = String(razorpayPaymentId);
    }

    if (checkout.paymentMethod !== 'online') {
      const created = await createSplitOrders({
        verifiedItems: checkout.items,
        customerName: checkout.customerName,
        customerPhone: checkout.customerPhone,
        notes: checkout.notes,
        userId: checkout.userId || user?.id || null,
        paymentMethod: checkout.paymentMethod,
        paymentStatus: 'unpaid',
        razorpayOrderId: '',
        razorpayPaymentId: '',
        deliveryAddress: address
      });
      await dbUpdateCheckout(checkout.id, {
        status: 'completed',
        deliveryAddress: address,
        createdOrders: created
      });
      return res.status(201).json({ orders: created, order: created[0] });
    }

    const result = await fulfillPaidCheckout(checkout, {
      paymentId,
      deliveryAddress: address,
      allowMissingDeliveryAddress: false
    });

    const created = result.orders;
    res.status(result.alreadyCompleted ? 200 : 201).json({
      orders: created,
      order: created[0],
      alreadyCompleted: result.alreadyCompleted
    });
  } catch (err) {
    console.error('[Checkout Complete Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Could not complete checkout.' });
  }
});

// ----------------- ORDERS & ZERO-TRUST SECURITY (Layers 01, 04, 05) -----------------

app.get('/api/orders', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders();
    res.json(orders.map(publicOrder));
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

    const isAdmin = await checkIsAdmin(req);
    const clientToken = req.headers['x-order-token'];
    const hasValidToken = Boolean(
      order && clientToken && timingSafeCompare(String(clientToken), String(order.accessToken))
    );
    const user = await getUserFromRequest(req);
    const isOwner = Boolean(order && user && order.userId && user.id === order.userId);

    if (!order || (!isAdmin && !hasValidToken && !isOwner)) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (isAdmin) {
      return res.json(publicOrder(order));
    }

    res.json({
      ...publicOrder(order),
      customerPhone: maskPhoneNumber(order.customerPhone)
    });
  } catch (err) {
    console.error('[Get Order By ID Error]', err);
    res.status(500).json({ error: 'Failed to retrieve order details.' });
  }
});

// Customer: Place Order (Layer 01 Server Validation + 256-bit unguessable accessToken)
app.post('/api/orders', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { items, notes, paymentMethod, deliveryAddress } = req.body;
    const method = paymentMethod === 'online' ? 'online' : 'counter';
    if (method === 'online') {
      return res.status(400).json({ error: 'Online payments must use /api/checkout/prepare.' });
    }

    const { customerName, cleanPhone, digitsOnly } = checkoutCustomerFields(req.body, user);
    if (!customerName || customerName.length < 2 || customerName.length > 60) {
      return res.status(400).json({ error: 'Please enter a valid name (2-60 characters).' });
    }
    if (!user && digitsOnly.length < 8) {
      return res.status(400).json({ error: 'Phone number is required for guest checkout.' });
    }
    if (digitsOnly.length < 8 || digitsOnly.length > 18) {
      return res.status(400).json({ error: 'Please enter a valid phone number (8-18 digits).' });
    }

    const { verifiedItems } = await verifyCartItems(items);
    const address = cartNeedsDeliveryAddress(verifiedItems)
      ? normalizeDeliveryAddress(deliveryAddress)
      : null;
    if (cartNeedsDeliveryAddress(verifiedItems) && !address) {
      return res.status(400).json({
        error: 'Delivery address is required for deliver-later items.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

    const created = await createSplitOrders({
      verifiedItems,
      customerName: customerName.slice(0, 60),
      customerPhone: cleanPhone,
      notes: notes ? String(notes).trim().slice(0, 250) : '',
      userId: user?.id || null,
      paymentMethod: 'counter',
      paymentStatus: 'unpaid',
      deliveryAddress: address
    });

    res.status(201).json({
      ...created[0],
      orders: created
    });
  } catch (err) {
    console.error('[Create Order Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to place order. Please try again.' });
  }
});

// Admin: Update order status (Strictly admin-only; customers cannot mutate status)
app.patch('/api/orders/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, trackingLink } = req.body;
    const existing = await dbGetOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const kitchenStatuses = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
    const deliveryStatuses = ['pending', 'shipped', 'delivered', 'rejected', 'refunded', 'cancelled'];
    const validStatuses = existing.fulfillmentType === 'delivery' ? deliveryStatuses : kitchenStatuses;

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const updates = { status };
    if (trackingLink !== undefined) updates.trackingLink = sanitizeTrackingUrl(trackingLink);
    if (status === 'refunded') updates.paymentStatus = 'refunded';
    if (status === 'preparing' && existing.paymentMethod === 'counter') updates.paymentStatus = 'paid';

    const updated = await dbUpdateOrder(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    res.json(publicOrder(updated));
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

    const kitchen = orders.filter(o => (o.fulfillmentType || 'immediate') !== 'delivery');
    const delivery = orders.filter(o => o.fulfillmentType === 'delivery');
    const collected = orders.filter(o =>
      o.paymentStatus === 'paid' &&
      o.status !== 'cancelled' &&
      o.status !== 'rejected'
    );
    const totalOrders = orders.length;
    const baseRevenue = collected.reduce(
      (sum, o) => sum + (Number(o.subtotalAmount) || Number(o.totalAmount) || 0),
      0
    );
    const taxCollected = collected.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);
    const totalRevenue = collected.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
    const pendingCount = kitchen.filter(o => o.status === 'pending').length;
    const preparingCount = kitchen.filter(o => o.status === 'preparing').length;
    const readyCount = kitchen.filter(o => o.status === 'ready').length;
    const completedCount = kitchen.filter(o => o.status === 'completed').length;
    const deliveryPendingCount = delivery.filter(o => o.status === 'pending').length;
    const deliveryShippedCount = delivery.filter(o => o.status === 'shipped').length;

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
      baseRevenue,
      taxCollected,
      pendingCount,
      preparingCount,
      readyCount,
      completedCount,
      deliveryPendingCount,
      deliveryShippedCount,
      deliveryCount: delivery.length,
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

    let csv = 'Order Number,Date,Time,Customer Name,Phone,Items Summary,Base Amount,GST,Total Amount,Status,Notes\n';
    orders.forEach(o => {
      const dateObj = new Date(o.createdAt);
      const dateStr = dateObj.toLocaleDateString();
      const timeStr = dateObj.toLocaleTimeString();
      const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join('; ');

      csv += [
        csvCell(o.orderNumber),
        csvCell(dateStr),
        csvCell(timeStr),
        csvCell(o.customerName),
        csvCell(o.customerPhone),
        csvCell(itemsSummary),
        csvCell(o.subtotalAmount || o.totalAmount),
        csvCell(o.taxAmount || 0),
        csvCell(o.totalAmount),
        csvCell(o.status),
        csvCell(o.notes)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=event_orders_${Date.now()}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('[CSV Export Error]', err);
    res.status(500).json({ error: 'Failed to export CSV report.' });
  }
});

app.post('/api/webhooks/razorpay', async (req, res) => {
  try {
    if (!isRazorpayWebhookConfigured()) {
      return res.status(503).json({ error: 'Webhook secret is not configured.' });
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid webhook payload.' });
    }

    const result = await handleRazorpayWebhookEvent(event);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Razorpay Webhook Error]', err);
    res.status(500).json({ error: 'Webhook handler failed.' });
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
  if (!process.env.ADMIN_PIN) {
    console.warn('⚠️ ADMIN_PIN is not set. Using the stored/default PIN. Set ADMIN_PIN before any public deployment.');
  }
});
