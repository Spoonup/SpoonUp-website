import dotenv from 'dotenv';
dotenv.config({ override: false });

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
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
  dbDeleteExpiredUserSessions,
  dbCreateCheckout,
  dbGetCheckoutById,
  dbUpdateCheckout,
  publicUser,
  DEFAULT_ORDER_LIMIT,
  MAX_ORDER_LIMIT
} from './db.js';
import { isSupabaseActive } from './supabase.js';
import {
  hashPassword,
  verifyPassword,
  timingSafeCompare,
  createAdminSession,
  isValidAdminSession,
  revokeAdminSession,
  sanitizeImageUrl,
  sanitizeTrackingUrl,
  csvCell,
  isValidUsername,
  isValidEmail,
  isValidAdminUsername,
  MIN_ADMIN_PASSWORD_LENGTH,
  MAX_ADMIN_PASSWORD_LENGTH
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
  fulfillPaidCheckout,
  claimCheckoutForFulfillment,
  loadCheckoutOrders,
  orderRefs,
  isCheckoutExpired
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
const isTest = process.env.NODE_ENV === 'test';

// ----------------- STARTUP GUARDS -----------------
// Production must never silently run on the local JSON file (ephemeral inside a container).
if (isProduction && !isSupabaseActive()) {
  console.error('❌ NODE_ENV=production but Supabase is not configured. Refusing to start on the local JSON database.');
  process.exit(1);
}

app.disable('x-powered-by');

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ----------------- EDGE AUTH & CLIENT IP -----------------
// When ORIGIN_AUTH_SECRET is set, only traffic that came through our Cloudflare Worker
// (which adds X-Origin-Auth) is accepted, and CF-Connecting-IP becomes the client IP
// for rate limiting. Without it, req.ip (per TRUST_PROXY) is used.
const originAuthSecret = String(process.env.ORIGIN_AUTH_SECRET || '').trim();
const ORIGIN_AUTH_EXEMPT = new Set(['/api/webhooks/razorpay', '/api/health']);

app.use((req, res, next) => {
  const requestPath = req.originalUrl.split('?')[0];
  let viaEdge = false;
  if (originAuthSecret) {
    const supplied = String(req.headers['x-origin-auth'] || '');
    viaEdge = Boolean(supplied) && timingSafeCompare(supplied, originAuthSecret);
    if (!viaEdge && !ORIGIN_AUTH_EXEMPT.has(requestPath)) {
      return res.status(403).json({ error: 'Direct access is not allowed.' });
    }
  }
  const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
  req.clientIp = viaEdge && cfIp ? cfIp : req.ip;
  next();
});

// ----------------- SECURITY HEADERS -----------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.razorpay.com https://api.razorpay.com; frame-ancestors 'none'"
  );
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  if (req.originalUrl.startsWith('/api')) {
    // API responses carry PII and tokens; nothing between here and the browser may cache them.
    res.setHeader('Cache-Control', 'no-store');
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
const clientKey = (req) => ipKeyGenerator(req.clientIp || req.ip || '');

const userAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Brute force protection on admin login: Max 5 FAILED attempts per 15 minutes per IP.
// Successful logins do not consume the budget, so staff sharing an IP cannot lock each other out.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Order creation spam protection: Max 30 orders per 5 minutes per IP
const orderCreateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Order rate limit reached. Please wait a few moments before placing another order.' }
});

// General API protection: Max 300 requests per minute
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip: (req) => req.originalUrl.split('?')[0] === '/api/webhooks/razorpay'
});
app.use('/api', generalLimiter);

// Invalid admin tokens are throttled separately so token guessing is as slow as password guessing.
const ADMIN_TOKEN_FAILURE_LIMIT = 20;
const ADMIN_TOKEN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const adminTokenFailures = new Map();

function recordAdminTokenFailure(key) {
  const now = Date.now();
  const entry = adminTokenFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    adminTokenFailures.set(key, { count: 1, resetAt: now + ADMIN_TOKEN_FAILURE_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function adminTokenFailuresExceeded(key) {
  const entry = adminTokenFailures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    adminTokenFailures.delete(key);
    return false;
  }
  return entry.count >= ADMIN_TOKEN_FAILURE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of adminTokenFailures) {
    if (entry.resetAt <= now) adminTokenFailures.delete(key);
  }
}, 5 * 60 * 1000).unref();

// ----------------- HELPERS -----------------
/**
 * Only domain errors (those with an explicit `status`) expose their message. Anything
 * else is an internal failure: log it, and send the generic fallback to the client.
 */
function sendError(res, err, fallback, context) {
  const status = Number(err?.status) || 500;
  if (status >= 500 || !err?.status) {
    console.error(`[${context}]`, err);
    return res.status(status).json({ error: fallback });
  }
  const body = { error: err.message || fallback };
  if (err.code) body.code = err.code;
  return res.status(status).json(body);
}

// One structured line per privileged action so a stolen token leaves a trail.
function auditLog(req, action, details = {}) {
  const token = String(getAdminCredential(req) || '');
  const actor = token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 12) : 'anonymous';
  console.log(JSON.stringify({
    audit: action,
    actor,
    ip: req.clientIp || req.ip,
    at: new Date().toISOString(),
    ...details
  }));
}

function publicOrder(order) {
  if (!order) return order;
  const { accessToken: _accessToken, ...safe } = order;
  return safe;
}

// The admin username is half of the staff credential, so it is never part of the
// public payload — only an authenticated admin sees it (see includeAdminFields).
function publicSettings(settings, { includeAdminFields = false } = {}) {
  return {
    eventName: settings.eventName,
    currencySymbol: settings.currencySymbol,
    counterName: settings.counterName,
    ...(includeAdminFields ? { adminUsername: settings.adminUsername || '' } : {}),
    upiId: settings.upiId || '',
    upiPhone: settings.upiPhone || '',
    databaseType: isSupabaseActive() ? 'Supabase PostgreSQL' : 'Local JSON',
    razorpayEnabled: isRazorpayConfigured(),
    razorpayKeyId: isRazorpayConfigured() ? getRazorpayKeyId() : ''
  };
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
  // x-admin-pin is the legacy header name kept so an older deployed bundle keeps working.
  return req.headers['x-admin-token'] || req.headers['x-admin-pin'] || (bearer.startsWith('adm_') ? bearer : '');
}

// Mask sensitive phone numbers for public customer receipt display
function maskPhoneNumber(phone) {
  if (!phone || phone.length < 5) return '••••••';
  const visibleLast4 = phone.slice(-4);
  const countryPrefix = phone.startsWith('+') ? phone.slice(0, 3) + ' ' : '';
  return `${countryPrefix}••••••${visibleLast4}`;
}

// ----------------- AUTHENTICATION & AUTHORIZATION (Layer 05) -----------------
/**
 * Admin access is granted only to a signed session token issued by POST /api/admin/login.
 * Raw credentials are never accepted here, so protected routes cannot be used as a
 * password-guessing oracle, and no scrypt work happens on this path.
 */
async function resolveAdmin(req) {
  const credential = String(getAdminCredential(req) || '').trim();
  if (!credential || credential.length > 512) return false;
  const key = clientKey(req);
  if (adminTokenFailuresExceeded(key)) return false;
  const settings = await dbGetSettings();
  const valid = isValidAdminSession(credential, settings);
  if (!valid) recordAdminTokenFailure(key);
  return valid;
}

async function authenticateAdmin(req, res, next) {
  const credential = String(getAdminCredential(req) || '').trim();
  if (!credential) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }
  if (adminTokenFailuresExceeded(clientKey(req))) {
    return res.status(429).json({ error: 'Too many failed admin requests. Please try again later.' });
  }
  try {
    if (await resolveAdmin(req)) {
      req.isAdmin = true;
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session.' });
  } catch (err) {
    console.error('[Auth Error]', err);
    return res.status(401).json({ error: 'Unauthorized: Authentication failed.' });
  }
}

async function checkIsAdmin(req) {
  try {
    return await resolveAdmin(req);
  } catch {
    return false;
  }
}

// ----------------- HEALTH -----------------
app.get('/api/health', async (req, res) => {
  try {
    await dbGetSettings();
    res.json({ ok: true, database: isSupabaseActive() ? 'supabase' : 'local' });
  } catch (err) {
    console.error('[Health Check Error]', err);
    res.status(503).json({ ok: false });
  }
});

// ----------------- PUBLIC SETTINGS -----------------
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbGetSettings();
    // The stored password hash is never returned, not even to an authenticated admin.
    // The username is returned only to one, so the Settings screen can prefill it.
    const isAdmin = await checkIsAdmin(req);
    res.json(publicSettings(settings, { includeAdminFields: isAdmin }));
  } catch (err) {
    sendError(res, err, 'Failed to retrieve application settings.', 'Settings API Error');
  }
});

// Admin Login (Layer 02 Rate Limited + Layer 03 Password Verified + Layer 04 Generic Errors)
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (
    !username || typeof username !== 'string' ||
    !password || typeof password !== 'string' ||
    password.length > MAX_ADMIN_PASSWORD_LENGTH
  ) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const settings = await dbGetSettings();
    // Always run the password comparison, even when the username is wrong, so the
    // response time does not reveal whether the username exists.
    const usernameMatches = timingSafeCompare(
      String(username).trim().toLowerCase(),
      String(settings.adminUsername || '').trim().toLowerCase()
    );
    const passwordMatches = await verifyPassword(password, String(settings.adminPassword || ''));

    if (usernameMatches && passwordMatches) {
      const sessionToken = createAdminSession(settings);
      auditLog(req, 'admin.login.success', { username: String(username).trim() });
      return res.json({
        success: true,
        token: sessionToken,
        settings: publicSettings(settings, { includeAdminFields: true })
      });
    }
    auditLog(req, 'admin.login.failure', { username: String(username).trim().slice(0, 32) });
    return res.status(401).json({ error: 'Invalid credentials.' });
  } catch (err) {
    sendError(res, err, 'Authentication service unavailable.', 'Admin Login Error');
  }
});

app.post('/api/admin/logout', async (req, res) => {
  const credential = String(getAdminCredential(req) || '').trim();
  if (credential) {
    revokeAdminSession(credential);
    auditLog(req, 'admin.logout');
  }
  res.json({ success: true });
});

app.put('/api/settings', authenticateAdmin, async (req, res) => {
  try {
    const { eventName, currencySymbol, adminUsername, adminPassword, currentPassword, counterName, upiId, upiPhone } = req.body || {};
    const updates = {};
    if (eventName && typeof eventName === 'string') updates.eventName = eventName.slice(0, 100).trim();
    if (currencySymbol && typeof currencySymbol === 'string') updates.currencySymbol = currencySymbol.slice(0, 8).trim();

    const changingCredential = adminUsername !== undefined || adminPassword !== undefined;
    if (changingCredential) {
      // Changing the login requires re-entering the current password, so a stolen
      // session token alone cannot lock the real staff out of their own dashboard.
      const settings = await dbGetSettings();
      const ok = typeof currentPassword === 'string' &&
        await verifyPassword(currentPassword, String(settings.adminPassword || ''));
      if (!ok) {
        return res.status(403).json({
          error: 'Enter your current password to change the admin login.',
          code: 'CURRENT_PASSWORD_REQUIRED'
        });
      }
    }

    if (adminUsername !== undefined) {
      const candidate = typeof adminUsername === 'string' ? adminUsername.trim() : '';
      if (!isValidAdminUsername(candidate)) {
        return res.status(400).json({ error: 'Admin username must be 3-32 letters, numbers, or underscores.' });
      }
      updates.adminUsername = candidate;
    }

    if (adminPassword !== undefined) {
      const candidate = typeof adminPassword === 'string' ? adminPassword : '';
      if (candidate.length < MIN_ADMIN_PASSWORD_LENGTH || candidate.length > MAX_ADMIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          error: `Admin password must be ${MIN_ADMIN_PASSWORD_LENGTH}-${MAX_ADMIN_PASSWORD_LENGTH} characters.`
        });
      }
      // Layer 03: Store the password as a salted scrypt hash
      updates.adminPassword = await hashPassword(candidate);
    }
    if (counterName && typeof counterName === 'string') updates.counterName = counterName.slice(0, 100).trim();
    if (upiId !== undefined) updates.upiId = String(upiId || '').slice(0, 80).trim();
    if (upiPhone !== undefined) updates.upiPhone = String(upiPhone || '').slice(0, 24).trim();

    const updated = await dbUpdateSettings(updates);
    auditLog(req, 'settings.update', { fields: Object.keys(updates) });
    res.json({
      success: true,
      settings: publicSettings(updated, { includeAdminFields: true }),
      // Either change re-fingerprints the credential, so every session (including
      // this one) is now revoked and the client must log in again.
      credentialChanged: Boolean(updates.adminUsername || updates.adminPassword)
    });
  } catch (err) {
    sendError(res, err, 'Failed to update settings.', 'Settings Update Error');
  }
});

// ----------------- PRODUCTS (Layer 01 Validated + Protected) -----------------
app.get('/api/products', async (req, res) => {
  try {
    const products = await dbGetProducts();
    res.json(products);
  } catch (err) {
    sendError(res, err, 'Failed to retrieve menu products.', 'Get Products Error');
  }
});

app.post('/api/products', authenticateAdmin, async (req, res) => {
  try {
    const { name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate } = req.body || {};
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
    auditLog(req, 'product.create', { productId: saved.id });
    res.status(201).json(saved);
  } catch (err) {
    sendError(res, err, 'Failed to save new product.', 'Add Product Error');
  }
});

app.put('/api/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate } = req.body || {};
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
    auditLog(req, 'product.update', { productId: id, fields: Object.keys(updates) });
    res.json(updated);
  } catch (err) {
    sendError(res, err, 'Failed to update product.', 'Update Product Error');
  }
});

app.post('/api/products/images', authenticateAdmin, async (req, res) => {
  try {
    const imageUrl = await uploadProductImage(req.body, {
      contentType: String(req.headers['content-type'] || '').split(';')[0].trim(),
      filename: String(req.headers['x-file-name'] || '')
    });
    auditLog(req, 'product.image.upload');
    res.status(201).json({ imageUrl });
  } catch (err) {
    sendError(res, err, 'Failed to upload product image.', 'Product Image Upload Error');
  }
});

app.delete('/api/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await dbDeleteProduct(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    auditLog(req, 'product.delete', { productId: id });
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    sendError(res, err, 'Failed to delete product.', 'Delete Product Error');
  }
});

// ----------------- CUSTOMER AUTH -----------------
app.post('/api/auth/signup', userAuthLimiter, async (req, res) => {
  try {
    const { username, password, email, phone } = req.body || {};
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3-32 letters, numbers, or underscores.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 8-128 characters.' });
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
      passwordHash: await hashPassword(password),
      email: mail,
      phone: cleanPhone,
      createdAt: new Date().toISOString()
    });
    const session = await dbCreateUserSession(user.id);
    res.status(201).json({ success: true, token: session.token, user: publicUser(user) });
  } catch (err) {
    sendError(res, err, 'Could not create account.', 'Signup Error');
  }
});

app.post('/api/auth/login', userAuthLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    // Same shape rule as signup, so a lookup can never contain pattern characters.
    if (!isValidUsername(username)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const user = await dbGetUserByUsername(username);
    if (!user || !(await verifyPassword(password, String(user.passwordHash)))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    // Opportunistic cleanup keeps the sessions table from growing forever.
    dbDeleteExpiredUserSessions().catch((err) => console.warn('[Session Cleanup]', err.message));
    const session = await dbCreateUserSession(user.id);
    res.json({ success: true, token: session.token, user: publicUser(user) });
  } catch (err) {
    sendError(res, err, 'Authentication service unavailable.', 'User Login Error');
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = String(getUserCredential(req) || '').trim();
  if (token) await dbDeleteUserSession(token).catch(() => {});
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
    sendError(res, err, 'Failed to retrieve your orders.', 'My Orders Error');
  }
});

function checkoutCustomerFields(body, user) {
  const nameFromUser = user?.username || '';
  const customerName = String(body.customerName || nameFromUser || '').trim();
  const phoneSource = body.customerPhone || user?.phone || '';
  const { cleanPhone, digitsOnly } = cleanPhoneNumber(phoneSource);
  return { customerName, cleanPhone, digitsOnly };
}

function validateCustomerFields(res, user, { customerName, digitsOnly }) {
  if (!customerName || customerName.length < 2 || customerName.length > 60) {
    res.status(400).json({ error: 'Please enter a valid name (2-60 characters).' });
    return false;
  }
  if (!user && digitsOnly.length < 8) {
    res.status(400).json({ error: 'Phone number is required for guest checkout.' });
    return false;
  }
  if (digitsOnly.length < 8 || digitsOnly.length > 18) {
    res.status(400).json({ error: 'Please enter a valid phone number (8-18 digits).' });
    return false;
  }
  return true;
}

// ----------------- CHECKOUT & RAZORPAY -----------------
/**
 * Creates a checkout session. For carts with deliver-later items the delivery address
 * is collected here, before any money moves, so a captured payment can always be
 * fulfilled by the webhook even if the customer never returns.
 */
app.post('/api/checkout/prepare', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { items, notes, paymentMethod, deliveryAddress } = req.body || {};
    const method = paymentMethod === 'online' ? 'online' : 'counter';
    const fields = checkoutCustomerFields(req.body || {}, user);
    if (!validateCustomerFields(res, user, fields)) return;
    const { customerName, cleanPhone } = fields;

    if (method === 'online' && !isRazorpayConfigured() && !isTest) {
      return res.status(503).json({ error: 'Online payments are not configured yet. Please pay at the counter.' });
    }

    const {
      verifiedItems,
      calculatedSubtotal,
      calculatedTax,
      calculatedTotal
    } = await verifyCartItems(items);
    const needsDeliveryAddress = cartNeedsDeliveryAddress(verifiedItems);
    const address = needsDeliveryAddress ? normalizeDeliveryAddress(deliveryAddress) : null;
    if (needsDeliveryAddress && !address && method === 'online') {
      return res.status(400).json({
        error: 'Please provide a delivery address before paying online.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

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
      deliveryAddress: address,
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
      needsDeliveryAddress: needsDeliveryAddress && !address,
      razorpayKeyId: method === 'online' ? getRazorpayKeyId() : '',
      razorpayOrderId
    });
  } catch (err) {
    sendError(res, err, 'Could not start checkout.', 'Checkout Prepare Error');
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
    } = req.body || {};

    const checkout = await dbGetCheckoutById(String(checkoutId || '').trim());
    if (!checkout || checkout.status === 'cancelled') {
      return res.status(404).json({ error: 'Checkout session not found.' });
    }
    if (checkout.status === 'failed') {
      return res.status(400).json({ error: 'Payment failed. Please try checkout again.' });
    }
    if (checkout.status === 'completed') {
      const existing = await loadCheckoutOrders(checkout);
      if (existing.length) {
        return res.json({ orders: existing, order: existing[0], alreadyCompleted: true });
      }
    }
    if (isCheckoutExpired(checkout)) {
      return res.status(410).json({ error: 'This checkout has expired. Please start again.', code: 'CHECKOUT_EXPIRED' });
    }

    const needsAddress = cartNeedsDeliveryAddress(checkout.items);
    const address = needsAddress
      ? (normalizeDeliveryAddress(deliveryAddress) || checkout.deliveryAddress || null)
      : null;
    if (needsAddress && !address) {
      return res.status(400).json({
        error: 'Please provide a delivery address for deliver-later items.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

    if (checkout.paymentMethod !== 'online') {
      // The claim makes a double-submit produce exactly one set of orders.
      const claim = await claimCheckoutForFulfillment(checkout, ['open']);
      if (claim.completed) {
        return res.json({ orders: claim.orders, order: claim.orders[0], alreadyCompleted: true });
      }
      let created;
      try {
        created = await createSplitOrders({
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
      } catch (err) {
        await dbUpdateCheckout(checkout.id, { status: 'open' }).catch(() => {});
        throw err;
      }
      await dbUpdateCheckout(checkout.id, {
        status: 'completed',
        deliveryAddress: address,
        createdOrders: orderRefs(created)
      });
      return res.status(201).json({ orders: created, order: created[0] });
    }

    const webhookPaid = ['paid', 'completed'].includes(checkout.status) && Boolean(checkout.razorpayPaymentId);
    let paymentId = checkout.razorpayPaymentId || '';
    if (!webhookPaid) {
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
    sendError(res, err, 'Could not complete checkout.', 'Checkout Complete Error');
  }
});

// ----------------- ORDERS & ZERO-TRUST SECURITY (Layers 01, 04, 05) -----------------

// Admin: newest-first list. ?limit= caps rows (default 500, max 1000); ?since=<ISO> returns
// only orders updated at or after that time so pollers can fetch deltas.
app.get('/api/orders', authenticateAdmin, async (req, res) => {
  try {
    const limit = Math.min(MAX_ORDER_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_ORDER_LIMIT));
    const sinceRaw = String(req.query.since || '').trim();
    const since = sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : null;
    const orders = await dbGetOrders({ limit, since });
    res.json(orders.map(publicOrder));
  } catch (err) {
    sendError(res, err, 'Failed to retrieve orders.', 'Get Orders Error');
  }
});

// Customer / Token-Authorized: Lookup single order with Zero-Trust protection
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id.length > 64) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    const order = await dbGetOrderById(id);

    const clientToken = req.headers['x-order-token'];
    const hasValidToken = Boolean(
      order && clientToken && timingSafeCompare(String(clientToken), String(order.accessToken))
    );
    // Only consult the admin/user stores when the order token did not already authorise us.
    const isAdmin = !hasValidToken && Boolean(order) && await checkIsAdmin(req);
    const user = !hasValidToken && !isAdmin && order ? await getUserFromRequest(req) : null;
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
    sendError(res, err, 'Failed to retrieve order details.', 'Get Order By ID Error');
  }
});

// Customer: Place Order (Layer 01 Server Validation + 256-bit unguessable accessToken)
app.post('/api/orders', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { items, notes, paymentMethod, deliveryAddress } = req.body || {};
    const method = paymentMethod === 'online' ? 'online' : 'counter';
    if (method === 'online') {
      return res.status(400).json({ error: 'Online payments must use /api/checkout/prepare.' });
    }

    const fields = checkoutCustomerFields(req.body || {}, user);
    if (!validateCustomerFields(res, user, fields)) return;
    const { customerName, cleanPhone } = fields;

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
    sendError(res, err, 'Failed to place order. Please try again.', 'Create Order Error');
  }
});

// Admin: Update order status (Strictly admin-only; customers cannot mutate status)
app.patch('/api/orders/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, trackingLink } = req.body || {};
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

    auditLog(req, 'order.status', { orderId: updated.id, from: existing.status, to: status });
    res.json(publicOrder(updated));
  } catch (err) {
    sendError(res, err, 'Failed to update order status.', 'Update Order Status Error');
  }
});

// ----------------- ANALYTICS & STATS -----------------
app.get('/api/stats', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders({ limit: MAX_ORDER_LIMIT });
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
    sendError(res, err, 'Failed to generate statistics.', 'Stats API Error');
  }
});

// Admin: CSV Export
app.get('/api/orders/export/csv', authenticateAdmin, async (req, res) => {
  try {
    const orders = await dbGetOrders({ limit: MAX_ORDER_LIMIT });

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

    auditLog(req, 'orders.export.csv', { rows: orders.length });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=event_orders_${Date.now()}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    sendError(res, err, 'Failed to export CSV report.', 'CSV Export Error');
  }
});

app.post('/api/webhooks/razorpay', async (req, res) => {
  try {
    if (!isRazorpayWebhookConfigured()) {
      return res.status(503).json({ error: 'Webhook secret is not configured.' });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Invalid webhook payload.' });
    }
    const rawBody = req.body;
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
    // A non-2xx makes Razorpay redeliver, which is what we want while another worker
    // holds the fulfilment lock.
    res.status(result.retry ? 503 : 200).json({ ok: !result.retry, ...result });
  } catch (err) {
    sendError(res, err, 'Webhook handler failed.', 'Razorpay Webhook Error');
  }
});

// ----------------- STATIC ASSETS & FALLBACK -----------------
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  index: false,
  setHeaders(res, filePath) {
    // Vite fingerprints everything under /assets, so those can be cached forever.
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  const indexPath = path.join(distPath, 'index.html');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('Event Order System Backend API is active.');
    }
  });
});

// Final JSON error handler: body-parser failures and anything thrown past a route.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return;
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error('[Unhandled Error]', err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error.' : (err.message || 'Request failed.') });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT} (0.0.0.0)`);
  if (!process.env.ADMIN_PASSWORD && !isSupabaseActive()) {
    console.warn('⚠️ ADMIN_PASSWORD is not set; the local database will use its stored (or a generated) password. Set ADMIN_PASSWORD before any public deployment.');
  }
  if (isProduction && !process.env.ADMIN_SESSION_SECRET) {
    console.warn('⚠️ ADMIN_SESSION_SECRET is not set: staff sessions will not survive restarts or multiple instances.');
  }
  if (isProduction && !originAuthSecret) {
    console.warn('⚠️ ORIGIN_AUTH_SECRET is not set: rate limits are keyed on the proxy IP, not the customer IP.');
  }
});
