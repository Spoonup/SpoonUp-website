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
  dbGetParentOrderById,
  dbGetOrderItemsBySubOrderIds,
  dbGetSubscriptionsByUserId,
  dbGetSubscriptionDeliveries,
  dbGetWalletBalance,
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
import { normalizeGstRate, roundMoney } from './tax.js';
import { buildCart } from './cart.js';
import { createParentOrderWithSubOrders } from './parentOrders.js';
import { assertTransition } from './orderStatus.js';
import { getStatement, adjust, creditSubscriptionFunding } from './wallet.js';
import {
  runSubscriptionDelivery,
  runDueDeliveries,
  failDelivery,
  skipDelivery,
  setSubscriptionStatus,
  getSubscriptionDetail
} from './subscriptionRuns.js';
import { FULFILLMENT_KIND_IDS } from './catalog.js';
import { PLATFORMS, normalizePlatform } from './pricing.js';
import { getCustomerHistory, resolveNegotiation, newAdminOrderId } from './adminOrders.js';
import { validateCoupon, redeemCoupon, releaseCoupon, createCoupon } from './coupons.js';
import {
  attachReferral, qualifyAndReward, getOrCreateCode, referralSummary, activeRule
} from './referrals.js';
import {
  dbGetCoupons,
  dbAddCouponCohortMembers,
  dbCreatePlatformPriceRule,
  dbGetPlatformPriceRules,
  dbCreateReferralRule
} from './db.js';
import {
  FREQUENCY_IDS,
  MIN_DURATION_MONTHS,
  MAX_DURATION_MONTHS,
  DEFAULT_PRICING_TIERS,
  quoteSubscription
} from './subscriptions.js';
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
// The scheduler calls this from Cloud Scheduler, not through the Worker, so it
// carries its own shared-secret header instead of the edge signature.
const ORIGIN_AUTH_EXEMPT = new Set([
  '/api/webhooks/razorpay',
  '/api/health',
  '/api/jobs/run-due-deliveries'
]);

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
  // Same reasoning as orderCreateLimiter: the suites share one server and one
  // client IP, so fixtures would exhaust 10 before the later assertions run.
  // Admin-login throttling (limit 5) is untouched — that is the one the security
  // suite actually asserts on.
  limit: isTest ? 500 : 10,
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
  // The suites share one server and one client IP, so 30 would be exhausted by
  // fixtures before the later checks run. Admin-login throttling is unchanged,
  // which is the limiter the security suite actually asserts on.
  limit: isTest ? 500 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Order rate limit reached. Please wait a few moments before placing another order.' }
});

// General API protection: Max 300 requests per minute
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  // Six suites hit one server from one IP inside a minute, which alone exceeds
  // the production budget. Raised for tests only; the admin-login brute-force
  // limiter is untouched and still asserted at its real threshold of 5.
  limit: isTest ? 20000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip: (req) => req.originalUrl.split('?')[0] === '/api/webhooks/razorpay'
});
app.use('/api', generalLimiter);

// Invalid admin tokens are throttled separately so token guessing is as slow as password guessing.
// Invalid-admin-token throttle. Relaxed in test mode only: the suites share one
// server and one client IP and deliberately send bad credentials, so the real
// threshold would trip partway through and mask the assertions that follow.
// Admin-LOGIN brute force (adminLoginLimiter, 5 failures) is untouched and is
// still asserted at its real threshold by test-security.js.
const ADMIN_TOKEN_FAILURE_LIMIT = isTest ? 500 : 20;
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
/**
 * Stable, non-reversible identity for the acting admin. The raw token is never
 * stored; this fingerprint is what lands in audit lines and in created_by_admin,
 * so the two always agree.
 */
function adminActor(req) {
  const token = String(getAdminCredential(req) || '');
  return token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 12) : 'anonymous';
}

function auditLog(req, action, details = {}) {
  const actor = req.adminFingerprint || adminActor(req);
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
    razorpayKeyId: isRazorpayConfigured() ? getRazorpayKeyId() : '',
    // Catalog capabilities, so clients never hardcode the taxonomy.
    fulfillmentKinds: FULFILLMENT_KIND_IDS,
    subscriptionFrequencies: FREQUENCY_IDS,
    subscriptionDurationMonths: { min: MIN_DURATION_MONTHS, max: MAX_DURATION_MONTHS },
    pricingTiers: DEFAULT_PRICING_TIERS
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
      // Attribution for anything this request writes.
      req.adminFingerprint = adminActor(req);
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

/**
 * Resolves the fulfilment taxonomy for a product write. `fulfillmentKind` is
 * authoritative when supplied; the legacy `deliverLater` boolean is accepted and
 * kept in sync both ways so old admin clients keep working.
 */
function normalizeFulfillment({ fulfillmentKind, deliverLater, leadTimeDays, prepMinutes }) {
  const kind = FULFILLMENT_KIND_IDS.includes(fulfillmentKind)
    ? fulfillmentKind
    : deliverLater
      ? 'DELIVERY_IN_DAYS'
      : 'IMMEDIATE';
  const clamp = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : null;
  };
  return {
    fulfillmentKind: kind,
    deliverLater: kind === 'DELIVERY_IN_DAYS',
    leadTimeDays: kind === 'DELIVERY_IN_DAYS' ? clamp(leadTimeDays, 90) : null,
    prepMinutes: kind === 'IMMEDIATE' ? clamp(prepMinutes, 1440) : null
  };
}

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
    const {
      name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate,
      fulfillmentKind, leadTimeDays, prepMinutes, subscribable, sellableOnce
    } = req.body || {};
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
      ...normalizeFulfillment({ fulfillmentKind, deliverLater, leadTimeDays, prepMinutes }),
      subscribable: Boolean(subscribable),
      sellableOnce: sellableOnce !== false,
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
    const {
      name, category, price, description, imageUrl, isAvailable, deliverLater, gstRate,
      fulfillmentKind, leadTimeDays, prepMinutes, subscribable, sellableOnce
    } = req.body || {};
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
    if (fulfillmentKind !== undefined || deliverLater !== undefined) {
      Object.assign(updates, normalizeFulfillment({ fulfillmentKind, deliverLater, leadTimeDays, prepMinutes }));
    }
    if (subscribable !== undefined) updates.subscribable = Boolean(subscribable);
    if (sellableOnce !== undefined) updates.sellableOnce = sellableOnce !== false;
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

    // A bad or self-referring code must never block the signup itself.
    let referral = null;
    if (req.body?.referralCode) {
      try {
        referral = await attachReferral({ code: req.body.referralCode, referredUserId: user.id });
      } catch (err) {
        referral = { error: err.code };
      }
    }
    await getOrCreateCode(user.id, uname).catch(() => {});

    res.status(201).json({
      success: true,
      token: session.token,
      user: publicUser(user),
      referral: referral && !referral.error ? { status: referral.status } : referral
    });
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
    const { items, lines, notes, paymentMethod, deliveryAddress, platform, couponCode } = req.body || {};
    const method = paymentMethod === 'online' ? 'online' : 'counter';
    const plat = normalizePlatform(platform);
    const fields = checkoutCustomerFields(req.body || {}, user);
    if (!validateCustomerFields(res, user, fields)) return;
    const { customerName, cleanPhone } = fields;

    if (method === 'online' && !isRazorpayConfigured() && !isTest) {
      return res.status(503).json({ error: 'Online payments are not configured yet. Please pay at the counter.' });
    }

    // The cart is built and priced here, then snapshotted onto the checkout, so
    // purchase mode, schedules and plan configuration survive the payment round
    // trip. verifyCartItems is still run for the legacy `items` column, which
    // anything reading an in-flight checkout still expects.
    const cartInput = Array.isArray(lines) && lines.length ? lines : items;
    const cart = await buildCart(cartInput, { platform: plat });
    const {
      verifiedItems,
      calculatedSubtotal,
      calculatedTax
    } = await verifyCartItems(
      cart.lines
        .filter((l) => l.purchaseMode !== 'SUBSCRIPTION')
        .map((l) => ({ id: l.productId, quantity: l.quantity }))
    ).catch(() => ({ verifiedItems: [], calculatedSubtotal: 0, calculatedTax: 0 }));

    // Reserve the coupon at prepare time so the amount sent to the gateway is
    // the amount that will be charged. Released if the checkout is not created.
    let couponForCart = null;
    let couponRedemption = null;
    if (couponCode) {
      const claimed = await redeemCoupon({
        code: couponCode,
        subtotal: cart.totals.calculatedTotal,
        userId: user?.id || null,
        phone: cleanPhone
      });
      couponRedemption = claimed.redemption;
      couponForCart = { couponId: claimed.coupon.id, code: claimed.coupon.code, discount: claimed.discount };
    }
    const calculatedTotal = roundMoney(
      Math.max(0, cart.totals.calculatedTotal - (couponForCart?.discount || 0))
    );

    const needsDeliveryAddress = cart.needsShippingAddress;
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

    try {
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
      platform: plat,
      cartSnapshot: { ...cart, coupon: couponForCart },
      createdOrders: [],
      createdAt: now,
      updatedAt: now
      });
    } catch (err) {
      // The reservation must not outlive a checkout that was never created.
      await releaseCoupon(couponRedemption?.id).catch(() => {});
      throw err;
    }

    res.json({
      checkoutId,
      subtotalAmount: calculatedSubtotal,
      taxAmount: calculatedTax,
      amount: calculatedTotal,
      paymentMethod: method,
      coupon: couponForCart ? { code: couponForCart.code, discount: couponForCart.discount } : null,
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
      let parentOrder = null;
      let subscriptions = [];
      try {
        if (checkout.cartSnapshot) {
          // Same parent-order path as the online flow. A counter order is not
          // paid yet, so any plan stays PENDING_PAYMENT and its wallet is left
          // unfunded until the cash is taken via /subscriptions/:id/mark-paid.
          const built = await createParentOrderWithSubOrders({
            cart: checkout.cartSnapshot,
            customerName: checkout.customerName,
            customerPhone: checkout.customerPhone,
            notes: checkout.notes,
            userId: checkout.userId || user?.id || null,
            platform: checkout.platform || 'WEB',
            source: 'CUSTOMER',
            paymentMethod: checkout.paymentMethod,
            paymentStatus: 'unpaid',
            deliveryAddress: address,
            coupon: checkout.cartSnapshot.coupon || null,
            parentOrderId: `par-${checkout.id.replace(/^chk-/, '')}`
          });
          created = built.subOrders;
          parentOrder = built.parent;
          subscriptions = built.subscriptions;
        } else {
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
        }
      } catch (err) {
        await dbUpdateCheckout(checkout.id, { status: 'open' }).catch(() => {});
        throw err;
      }
      await dbUpdateCheckout(checkout.id, {
        status: 'completed',
        deliveryAddress: address,
        parentOrderId: parentOrder?.id || null,
        createdOrders: orderRefs(created)
      });
      return res.status(201).json({ orders: created, order: created[0], parentOrder, subscriptions });
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

// ----------------- CART QUOTE & PARENT ORDERS -----------------

/**
 * Prices a cart without creating anything. The client sends identifiers,
 * quantities and scheduling/subscription configuration only — every amount in
 * the response is computed here from the product rows.
 */
app.post('/api/cart/quote', generalLimiter, async (req, res) => {
  try {
    const platform = normalizePlatform(req.body?.platform);
    const cart = await buildCart(req.body?.lines, { platform });
    // Advisory coupon preview: validated, never reserved here.
    let couponPreview = null;
    if (req.body?.couponCode) {
      const user = await getUserFromRequest(req);
      try {
        const v = await validateCoupon({
          code: req.body.couponCode,
          subtotal: cart.totals.calculatedTotal,
          userId: user?.id || null,
          phone: req.body?.customerPhone
        });
        couponPreview = { code: v.coupon.code, discount: v.discount, valid: true };
      } catch (err) {
        couponPreview = { code: String(req.body.couponCode), valid: false, reason: err.code };
      }
    }
    res.json({
      platform,
      coupon: couponPreview,
      lines: cart.lines,
      parts: cart.parts.map((part) => ({
        subOrderType: part.subOrderType,
        scheduledFor: part.scheduledFor,
        itemCount: part.lines.length,
        subtotalAmount: part.subtotalAmount,
        taxAmount: part.taxAmount,
        totalAmount: part.totalAmount
      })),
      subscriptions: cart.subscriptionIntents.map((i) => i.subscription),
      needsShippingAddress: cart.needsShippingAddress,
      totals: cart.totals
    });
  } catch (err) {
    sendError(res, err, 'Could not price this cart.', 'Cart Quote Error');
  }
});

/**
 * Creates a parent order with one sub-order per fulfilment part, plus any
 * subscription plans. Counter payment only — online money still goes through
 * /api/checkout/prepare so the Razorpay claim and signature checks are unchanged.
 */
app.post('/api/parent-orders', orderCreateLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { lines, notes, deliveryAddress, platform, couponCode } = req.body || {};

    const fields = checkoutCustomerFields(req.body || {}, user);
    if (!validateCustomerFields(res, user, fields)) return;
    const { customerName, cleanPhone } = fields;

    const plat = normalizePlatform(platform);
    const cart = await buildCart(lines, { platform: plat });
    const address = cart.needsShippingAddress ? normalizeDeliveryAddress(deliveryAddress) : null;
    if (cart.needsShippingAddress && !address) {
      return res.status(400).json({
        error: 'Delivery address is required for deliver-later items.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

    // Reserve the coupon BEFORE the order exists. The unique redemption index
    // decides a concurrent race; the loser never gets a discounted order.
    let redemption = null;
    let couponForOrder = null;
    if (couponCode) {
      const claimed = await redeemCoupon({
        code: couponCode,
        subtotal: cart.totals.calculatedTotal,
        userId: user?.id || null,
        phone: cleanPhone
      });
      redemption = claimed.redemption;
      couponForOrder = { couponId: claimed.coupon.id, code: claimed.coupon.code, discount: claimed.discount };
    }

    let result;
    try {
      result = await createParentOrderWithSubOrders({
        cart,
        customerName: customerName.slice(0, 60),
        customerPhone: cleanPhone,
        notes: notes ? String(notes).trim().slice(0, 250) : '',
        userId: user?.id || null,
        platform: plat,
        source: 'CUSTOMER',
        paymentMethod: 'counter',
        paymentStatus: 'unpaid',
        deliveryAddress: address,
        coupon: couponForOrder
      });
    } catch (err) {
      // Give the coupon back if the order it was reserved for never happened.
      await releaseCoupon(redemption?.id).catch(() => {});
      throw err;
    }

    auditLog(req, 'parent_order.create', {
      parentOrderId: result.parent.id,
      subOrders: result.subOrders.length,
      subscriptions: result.subscriptions.length
    });

    res.status(201).json({
      parentOrder: result.parent,
      subOrders: result.subOrders.map(publicOrder),
      subscriptions: result.subscriptions,
      // Access tokens are returned once, to the creator only.
      orderTokens: result.subOrders.map((o) => ({ id: o.id, accessToken: o.accessToken }))
    });
  } catch (err) {
    sendError(res, err, 'Could not create the order.', 'Parent Order Error');
  }
});

/** Admin view of a parent order and everything hanging off it. */
app.get('/api/parent-orders/:id', authenticateAdmin, async (req, res) => {
  try {
    const parent = await dbGetParentOrderById(req.params.id);
    if (!parent) return res.status(404).json({ error: 'Order not found.' });
    const all = await dbGetOrders({ limit: MAX_ORDER_LIMIT });
    const subOrders = all.filter((o) => o.parentOrderId === parent.id);
    const items = await dbGetOrderItemsBySubOrderIds(subOrders.map((o) => o.id));
    res.json({
      parentOrder: parent,
      subOrders: subOrders.map(publicOrder),
      items
    });
  } catch (err) {
    sendError(res, err, 'Could not load the order.', 'Parent Order Fetch Error');
  }
});

/** Plan quote without committing — used by the plan builder. */
app.post('/api/subscriptions/quote', generalLimiter, async (req, res) => {
  try {
    const { productId, frequency, durationMonths } = req.body || {};
    const products = await dbGetProducts();
    const product = products.find((p) => p.id === productId);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    if (!product.subscribable) {
      return res.status(400).json({ error: 'This product cannot be bought on a plan.', code: 'NOT_SUBSCRIBABLE' });
    }
    const quote = quoteSubscription({
      unitPrice: product.price,
      gstRate: product.gstRate,
      frequency,
      durationMonths
    });
    res.json({ productId: product.id, productName: product.name, ...quote });
  } catch (err) {
    sendError(res, err, 'Could not price this plan.', 'Subscription Quote Error');
  }
});

/** A signed-in customer's own plans, with their schedule and wallet balance. */
app.get('/api/me/subscriptions', authenticateUser, async (req, res) => {
  try {
    const subs = await dbGetSubscriptionsByUserId(req.user.id);
    const detailed = await Promise.all(
      subs.map(async (sub) => ({
        ...sub,
        walletBalance: sub.walletId ? await dbGetWalletBalance(sub.walletId) : 0,
        deliveries: await dbGetSubscriptionDeliveries(sub.id)
      }))
    );
    res.json(detailed);
  } catch (err) {
    sendError(res, err, 'Could not load your plans.', 'My Subscriptions Error');
  }
});

// ----------------- ADMIN: CUSTOMER HISTORY & ORDERS ON BEHALF -----------------

/**
 * Complete historical record for one customer: every order ever placed with its
 * sub-orders, items, money, payment, plus plans and wallet ledgers. Not limited
 * to active orders.
 */
app.get('/api/admin/customers/history', authenticateAdmin, async (req, res) => {
  try {
    const history = await getCustomerHistory({
      userId: req.query.userId ? String(req.query.userId) : null,
      phone: req.query.phone ? String(req.query.phone) : null
    });
    auditLog(req, 'customer.history.read', {
      userId: req.query.userId || null,
      orders: history.totals.orderCount
    });
    res.json(history);
  } catch (err) {
    sendError(res, err, 'Could not load the customer history.', 'Customer History Error');
  }
});

/**
 * Creates an order on behalf of a customer.
 *
 * The admin supplies the agreed FINAL price; the discount is derived from the
 * server's own calculated total, so the two can never disagree and an admin can
 * never type a discount that does not match the arithmetic.
 */
app.post('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const {
      lines, customerName, customerPhone, userId, notes,
      deliveryAddress, platform, negotiatedTotal, negotiationReason, couponCode
    } = req.body || {};

    const name = String(customerName || '').trim();
    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ error: 'A customer name of 2-60 characters is required.' });
    }
    const { cleanPhone, digitsOnly } = cleanPhoneNumber(customerPhone);
    if (digitsOnly.length < 8 || digitsOnly.length > 18) {
      return res.status(400).json({ error: 'A valid customer phone number (8-18 digits) is required.' });
    }

    const plat = normalizePlatform(platform || 'ADMIN');
    const cart = await buildCart(lines, { platform: plat });

    const address = cart.needsShippingAddress ? normalizeDeliveryAddress(deliveryAddress) : null;
    if (cart.needsShippingAddress && !address) {
      return res.status(400).json({
        error: 'Delivery address is required for deliver-later items.',
        code: 'NEEDS_DELIVERY_ADDRESS'
      });
    }

    // Coupon first, so the negotiated price is judged against the real total.
    let redemption = null;
    let couponForOrder = null;
    if (couponCode) {
      const claimed = await redeemCoupon({
        code: couponCode,
        subtotal: cart.totals.calculatedTotal,
        userId: userId || null,
        phone: cleanPhone
      });
      redemption = claimed.redemption;
      couponForOrder = { couponId: claimed.coupon.id, code: claimed.coupon.code, discount: claimed.discount };
    }

    const afterCoupon = roundMoney(
      Math.max(0, cart.totals.calculatedTotal - (couponForOrder?.discount || 0))
    );

    let negotiation;
    try {
      negotiation = resolveNegotiation(afterCoupon, negotiatedTotal);
    } catch (err) {
      await releaseCoupon(redemption?.id).catch(() => {});
      throw err;
    }

    let result;
    try {
      result = await createParentOrderWithSubOrders({
        cart,
        customerName: name.slice(0, 60),
        customerPhone: cleanPhone,
        notes: [
          notes ? String(notes).trim() : '',
          negotiation.negotiatedTotal != null
            ? `Negotiated ${negotiation.negotiatedTotal} vs ${afterCoupon} (-${negotiation.negotiatedDiscount})`
            : '',
          negotiationReason ? `Reason: ${String(negotiationReason).trim()}` : ''
        ].filter(Boolean).join(' · ').slice(0, 250),
        userId: userId || null,
        platform: plat,
        source: 'ADMIN',
        paymentMethod: 'counter',
        paymentStatus: 'unpaid',
        deliveryAddress: address,
        coupon: couponForOrder,
        negotiatedTotal: negotiation.negotiatedTotal,
        createdByAdmin: req.adminFingerprint,
        parentOrderId: newAdminOrderId()
      });
    } catch (err) {
      await releaseCoupon(redemption?.id).catch(() => {});
      throw err;
    }

    auditLog(req, 'admin_order.create', {
      parentOrderId: result.parent.id,
      calculatedTotal: result.parent.calculatedTotal,
      negotiatedTotal: negotiation.negotiatedTotal,
      negotiatedDiscount: negotiation.negotiatedDiscount,
      subOrders: result.subOrders.length,
      reason: negotiationReason ? String(negotiationReason).slice(0, 120) : null
    });

    res.status(201).json({
      parentOrder: result.parent,
      subOrders: result.subOrders.map(publicOrder),
      subscriptions: result.subscriptions,
      negotiation
    });
  } catch (err) {
    sendError(res, err, 'Could not create the order.', 'Admin Order Error');
  }
});

// ----------------- COUPONS, REFERRALS & PLATFORM PRICING -----------------

app.post('/api/coupons', authenticateAdmin, async (req, res) => {
  try {
    const coupon = await createCoupon(req.body || {}, req.adminFingerprint || 'admin');
    if (coupon.scope === 'COHORT' && Array.isArray(req.body?.cohortUserIds)) {
      await dbAddCouponCohortMembers(coupon.id, req.body.cohortUserIds.slice(0, 5000));
    }
    auditLog(req, 'coupon.create', { couponId: coupon.id, code: coupon.code, scope: coupon.scope });
    res.status(201).json(coupon);
  } catch (err) {
    sendError(res, err, 'Could not create the coupon.', 'Coupon Create Error');
  }
});

app.get('/api/coupons', authenticateAdmin, async (req, res) => {
  try {
    res.json(await dbGetCoupons());
  } catch (err) {
    sendError(res, err, 'Could not load coupons.', 'Coupon List Error');
  }
});

/** Advisory validation for the checkout screen; reserves nothing. */
app.post('/api/coupons/validate', generalLimiter, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    const { coupon, discount } = await validateCoupon({
      code: req.body?.code,
      subtotal: Number(req.body?.subtotal) || 0,
      userId: user?.id || null,
      phone: req.body?.phone
    });
    res.json({ valid: true, code: coupon.code, discountType: coupon.discountType, discount });
  } catch (err) {
    if (err.code && err.status === 400) {
      return res.status(200).json({ valid: false, reason: err.code, message: err.message });
    }
    sendError(res, err, 'Could not check that coupon.', 'Coupon Validate Error');
  }
});

app.post('/api/platform-price-rules', authenticateAdmin, async (req, res) => {
  try {
    const { platform, scope, scopeRef, adjustmentType, adjustmentValue, effectiveTo } = req.body || {};
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `Platform must be one of: ${PLATFORMS.join(', ')}` });
    }
    if (!['PERCENT', 'FLAT'].includes(adjustmentType)) {
      return res.status(400).json({ error: 'Adjustment type must be PERCENT or FLAT.' });
    }
    const value = Number(adjustmentValue);
    if (!Number.isFinite(value)) return res.status(400).json({ error: 'Adjustment value must be numeric.' });

    const rule = await dbCreatePlatformPriceRule({
      id: `ppr-${crypto.randomUUID()}`,
      platform,
      scope: ['GLOBAL', 'CATEGORY', 'PRODUCT'].includes(scope) ? scope : 'GLOBAL',
      scopeRef: scopeRef || null,
      adjustmentType,
      adjustmentValue: value,
      effectiveFrom: new Date().toISOString(),
      effectiveTo: effectiveTo || null,
      isActive: true,
      createdAt: new Date().toISOString()
    });
    auditLog(req, 'pricing.rule.create', { ruleId: rule.id, platform, scope: rule.scope });
    res.status(201).json(rule);
  } catch (err) {
    sendError(res, err, 'Could not create the pricing rule.', 'Pricing Rule Error');
  }
});

app.get('/api/platform-price-rules', authenticateAdmin, async (req, res) => {
  try {
    res.json(await dbGetPlatformPriceRules());
  } catch (err) {
    sendError(res, err, 'Could not load pricing rules.', 'Pricing Rule List Error');
  }
});

/** Bonus amounts are configuration, not code: a new rule supersedes the old. */
app.post('/api/referral-rules', authenticateAdmin, async (req, res) => {
  try {
    const { referrerAmount, referredAmount, qualifyingEvent, minOrderAmount } = req.body || {};
    const rule = await dbCreateReferralRule({
      id: `rrl-${crypto.randomUUID()}`,
      referrerAmount: Math.max(0, Number(referrerAmount) || 0),
      referredAmount: Math.max(0, Number(referredAmount) || 0),
      qualifyingEvent: qualifyingEvent || 'FIRST_ORDER_PAID',
      minOrderAmount: Math.max(0, Number(minOrderAmount) || 0),
      effectiveFrom: new Date().toISOString(),
      effectiveTo: null,
      isActive: true
    });
    auditLog(req, 'referral.rule.create', { ruleId: rule.id });
    res.status(201).json(rule);
  } catch (err) {
    sendError(res, err, 'Could not create the referral rule.', 'Referral Rule Error');
  }
});

app.get('/api/referral-rules/active', authenticateAdmin, async (req, res) => {
  try {
    res.json(await activeRule());
  } catch (err) {
    sendError(res, err, 'Could not load the referral rule.', 'Referral Rule Error');
  }
});

/** The signed-in customer's own code and progress. */
app.get('/api/me/referrals', authenticateUser, async (req, res) => {
  try {
    await getOrCreateCode(req.user.id, req.user.username);
    res.json(await referralSummary(req.user.id));
  } catch (err) {
    sendError(res, err, 'Could not load your referrals.', 'Referral Summary Error');
  }
});

/** Admin trigger for the qualifying event, until it is wired to payment capture. */
app.post('/api/referrals/qualify', authenticateAdmin, async (req, res) => {
  try {
    const result = await qualifyAndReward({
      referredUserId: String(req.body?.referredUserId || ''),
      parentOrderId: req.body?.parentOrderId || null,
      orderAmount: Number(req.body?.orderAmount) || 0
    });
    auditLog(req, 'referral.qualify', {
      referredUserId: req.body?.referredUserId, rewarded: result.rewarded, reason: result.reason || null
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not process the referral.', 'Referral Qualify Error');
  }
});

// ----------------- SCHEDULED JOBS -----------------

/**
 * Subscription delivery runner, for Cloud Scheduler (or any external cron).
 *
 * Authenticated by SCHEDULER_SECRET rather than an admin session, because a
 * scheduler has no session to present. Without the variable set the endpoint is
 * disabled outright — it never falls open.
 *
 * Safe to run from several instances at once: every delivery is taken with a
 * conditional UPDATE, so concurrent callers cannot both process the same one.
 * Safe to retry: the wallet debit is keyed on the delivery id.
 */
app.post('/api/jobs/run-due-deliveries', async (req, res) => {
  try {
    const secret = process.env.SCHEDULER_SECRET || '';
    if (!secret) {
      return res.status(503).json({ error: 'Scheduler is not configured.', code: 'SCHEDULER_DISABLED' });
    }
    const supplied = String(req.headers['x-scheduler-secret'] || '');
    if (!supplied || !timingSafeCompare(supplied, secret)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const body = Buffer.isBuffer(req.body) ? {} : (req.body || {});
    const started = Date.now();
    const result = await runDueDeliveries({
      onDate: body.onDate ? String(body.onDate).slice(0, 10) : undefined,
      limit: Math.min(500, Math.max(1, parseInt(body.limit, 10) || 200))
    });
    console.log(JSON.stringify({
      audit: 'scheduler.run_due',
      at: new Date().toISOString(),
      ms: Date.now() - started,
      attempted: result.attempted,
      generated: result.generated,
      skipped: result.skipped,
      failed: result.failed
    }));
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Scheduler run failed.', 'Scheduler Error');
  }
});

// ----------------- SUBSCRIPTION RUNTIME & WALLET -----------------

/**
 * Generates every planned delivery whose date has arrived. Idempotent: each
 * delivery is claimed with a conditional update, so running this twice (or from
 * two workers) produces one sub-order per delivery.
 */
app.post('/api/subscriptions/run-due', authenticateAdmin, async (req, res) => {
  try {
    const { onDate, limit } = req.body || {};
    const result = await runDueDeliveries({
      onDate: onDate ? String(onDate).slice(0, 10) : undefined,
      limit: Math.min(500, Math.max(1, parseInt(limit, 10) || 200))
    });
    auditLog(req, 'subscription.run_due', {
      attempted: result.attempted, generated: result.generated, failed: result.failed
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not run subscription deliveries.', 'Subscription Run Error');
  }
});

/** Runs one delivery now — used by staff to pull a delivery forward. */
app.post('/api/subscriptions/deliveries/:id/run', authenticateAdmin, async (req, res) => {
  try {
    const result = await runSubscriptionDelivery(req.params.id, { force: Boolean(req.body?.force) });
    auditLog(req, 'subscription.delivery.run', { deliveryId: req.params.id, ran: result.ran });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not run this delivery.', 'Delivery Run Error');
  }
});

/** Marks a generated delivery failed and returns its money to the plan wallet. */
app.post('/api/subscriptions/deliveries/:id/fail', authenticateAdmin, async (req, res) => {
  try {
    const result = await failDelivery(req.params.id, String(req.body?.reason || '').slice(0, 200));
    auditLog(req, 'subscription.delivery.fail', { deliveryId: req.params.id, changed: result.changed });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not fail this delivery.', 'Delivery Fail Error');
  }
});

/** Skips a planned delivery. Never debited, so nothing to reverse. */
app.post('/api/subscriptions/deliveries/:id/skip', authenticateAdmin, async (req, res) => {
  try {
    const result = await skipDelivery(req.params.id);
    auditLog(req, 'subscription.delivery.skip', { deliveryId: req.params.id, changed: result.changed });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not skip this delivery.', 'Delivery Skip Error');
  }
});

app.patch('/api/subscriptions/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const updated = await setSubscriptionStatus(req.params.id, String(req.body?.status || ''));
    auditLog(req, 'subscription.status', { subscriptionId: req.params.id, to: updated.status });
    res.json(updated);
  } catch (err) {
    sendError(res, err, 'Could not update this plan.', 'Subscription Status Error');
  }
});

app.get('/api/subscriptions/:id', authenticateAdmin, async (req, res) => {
  try {
    res.json(await getSubscriptionDetail(req.params.id));
  } catch (err) {
    sendError(res, err, 'Could not load this plan.', 'Subscription Detail Error');
  }
});

/** Full auditable statement: every ledger row plus the derived balance. */
app.get('/api/wallets/:id/statement', authenticateAdmin, async (req, res) => {
  try {
    res.json(await getStatement(req.params.id));
  } catch (err) {
    sendError(res, err, 'Could not load the wallet.', 'Wallet Statement Error');
  }
});

/**
 * Manual correction. Signed amount: negative debits. Always attributed and
 * reasoned — there is no withdrawal endpoint, only ledger entries.
 */
app.post('/api/wallets/:id/adjust', authenticateAdmin, async (req, res) => {
  try {
    const { amount, reason, reference } = req.body || {};
    const result = await adjust({
      walletId: req.params.id,
      amount: Number(amount),
      reason: String(reason || ''),
      reference,
      createdByAdmin: req.adminFingerprint || 'admin'
    });
    auditLog(req, 'wallet.adjust', {
      walletId: req.params.id, amount: Number(amount), duplicate: result.duplicate
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'Could not adjust the wallet.', 'Wallet Adjust Error');
  }
});

/**
 * Marks an unpaid plan funded. Used by the counter flow once cash is taken; the
 * credit is keyed on the subscription so calling it twice credits once.
 */
app.post('/api/subscriptions/:id/mark-paid', authenticateAdmin, async (req, res) => {
  try {
    const { subscription } = await getSubscriptionDetail(req.params.id);
    if (subscription.status === 'CANCELLED') {
      return res.status(400).json({ error: 'This plan is cancelled.', code: 'SUBSCRIPTION_CANCELLED' });
    }
    const result = await creditSubscriptionFunding({
      walletId: subscription.walletId,
      subscriptionId: subscription.id,
      amount: subscription.totalAmount,
      parentOrderId: subscription.parentOrderId
    });
    if (subscription.status === 'PENDING_PAYMENT') {
      await setSubscriptionStatus(subscription.id, 'ACTIVE');
    }
    auditLog(req, 'subscription.mark_paid', {
      subscriptionId: subscription.id, duplicate: result.duplicate
    });
    res.json({ ...result, subscription: await getSubscriptionDetail(subscription.id) });
  } catch (err) {
    sendError(res, err, 'Could not mark this plan paid.', 'Subscription Mark Paid Error');
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

    // Only orders created under the parent/sub-order model follow the per-type
    // machines. A row with no parent predates it, so it keeps the flat legacy
    // vocabulary it was created with — sub_order_type is backfilled for
    // reporting and must not retroactively change how an old order behaves.
    const machineKey = existing.parentOrderId
      ? existing.subOrderType
      : existing.fulfillmentType === 'delivery'
        ? 'delivery'
        : 'immediate';
    try {
      assertTransition(machineKey, existing.status, status);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message, code: err.code });
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

    // Razorpay's own event id is the de-duplication key for redeliveries.
    const result = await handleRazorpayWebhookEvent(event, {
      eventId: String(req.headers['x-razorpay-event-id'] || '')
    });
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
