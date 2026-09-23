import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

// Explicit scrypt parameters so the cost is pinned regardless of Node defaults.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Admin session tokens are stateless and HMAC-signed so they survive restarts,
 * scale-to-zero, and multiple Cloud Run instances. The secret comes from
 * ADMIN_SESSION_SECRET; without it we fall back to a per-process random secret
 * (sessions then only work on the instance that issued them).
 */
const sessionSecret = (() => {
  const fromEnv = String(process.env.ADMIN_SESSION_SECRET || '').trim();
  if (fromEnv.length >= 32) return fromEnv;
  if (fromEnv) {
    console.warn('⚠️ ADMIN_SESSION_SECRET is shorter than 32 characters; using a per-process secret instead.');
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️ ADMIN_SESSION_SECRET is not set. Admin sessions will not survive restarts or span instances.');
  }
  return crypto.randomBytes(32).toString('hex');
})();

// Best-effort revocation list for explicit logouts (per instance; tokens also expire on their own).
const revokedSessions = new Map();

function pruneRevoked() {
  const now = Date.now();
  for (const [token, exp] of revokedSessions) {
    if (exp <= now) revokedSessions.delete(token);
  }
}

// Async scrypt runs in the libuv threadpool and never blocks the event loop.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(String(password).trim(), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(candidate, storedHash) {
  if (typeof candidate !== 'string' || typeof storedHash !== 'string') return false;
  const trimmedCandidate = candidate.trim();
  const trimmedStored = storedHash.trim();
  if (!trimmedCandidate || !trimmedStored) return false;

  if (trimmedStored.includes(':')) {
    const separator = trimmedStored.indexOf(':');
    const salt = trimmedStored.slice(0, separator);
    const keyHex = trimmedStored.slice(separator + 1);
    if (!salt || !keyHex) return false;
    try {
      const derivedKey = await scryptAsync(trimmedCandidate, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
      const keyBuffer = Buffer.from(keyHex, 'hex');
      if (derivedKey.length !== keyBuffer.length) return false;
      return crypto.timingSafeEqual(derivedKey, keyBuffer);
    } catch {
      return false;
    }
  }

  // Legacy plaintext value (fresh install before the first hash migration).
  return timingSafeCompare(trimmedCandidate, trimmedStored);
}

export function timingSafeCompare(input, target) {
  if (typeof input !== 'string' || typeof target !== 'string') return false;
  const a = Buffer.from(crypto.createHash('sha256').update(input.trim()).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(target.trim()).digest());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Short fingerprint of the stored admin credential (username + password hash).
 * It is embedded in every admin session so that changing either the username or
 * the password invalidates all sessions issued under the old credential.
 */
export function adminCredentialVersion(username, storedPasswordHash) {
  return crypto
    .createHash('sha256')
    .update(`${String(username || '').trim().toLowerCase()}\u0000${String(storedPasswordHash || '')}`)
    .digest('hex')
    .slice(0, 16);
}

// Settings carry the admin credential; this keeps the fingerprint call in one place.
export function adminCredentialVersionFromSettings(settings) {
  return adminCredentialVersion(settings?.adminUsername, settings?.adminPassword);
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', sessionSecret).update(payloadB64).digest('base64url');
}

export function createAdminSession(settings) {
  const payload = {
    exp: Date.now() + SESSION_TTL_MS,
    cv: adminCredentialVersionFromSettings(settings),
    n: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `adm_${payloadB64}.${signPayload(payloadB64)}`;
}

/**
 * Returns true only for a well-formed, correctly signed, unexpired token whose
 * credential version matches the credential currently stored (so changing the
 * admin username or password revokes every existing session).
 */
export function isValidAdminSession(token, settings) {
  if (!token || typeof token !== 'string' || !token.startsWith('adm_')) return false;
  const body = token.slice(4);
  const dot = body.indexOf('.');
  if (dot === -1) return false;
  const payloadB64 = body.slice(0, dot);
  const signature = body.slice(dot + 1);
  if (!payloadB64 || !signature) return false;

  const expected = signPayload(payloadB64);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return false;
  // Tokens issued by the old PIN scheme carry `pv` and no `cv`; they are rejected here.
  if (settings !== undefined && payload.cv !== adminCredentialVersionFromSettings(settings)) return false;

  pruneRevoked();
  if (revokedSessions.has(token)) return false;
  return true;
}

export function revokeAdminSession(token) {
  if (!token || typeof token !== 'string') return;
  const body = token.slice(4);
  const payloadB64 = body.slice(0, body.indexOf('.'));
  let exp = Date.now() + SESSION_TTL_MS;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number') exp = payload.exp;
  } catch {
    // keep default expiry
  }
  revokedSessions.set(token, exp);
}

// Only https is allowed for stored URLs: the site is served over TLS and http would be mixed content.
export function sanitizeHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString().slice(0, 500);
  } catch {
    return '';
  }
}

export const sanitizeImageUrl = sanitizeHttpUrl;
export const sanitizeTrackingUrl = sanitizeHttpUrl;

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@|]/.test(text) || text.startsWith('\t') || text.startsWith('\r')) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function isHashedSecret(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(value);
}

export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createUserSessionToken() {
  return `usr_${crypto.randomBytes(32).toString('hex')}`;
}

export function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(String(username || '').trim());
}

export function isValidEmail(email) {
  const value = String(email || '').trim();
  return value.length >= 5 && value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Escapes LIKE/ILIKE metacharacters so user input can never act as a wildcard.
export function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const MIN_ADMIN_PASSWORD_LENGTH = 8;
export const MAX_ADMIN_PASSWORD_LENGTH = 128;

// Admin usernames follow the same shape rule as customer usernames, so a lookup
// can never contain pattern characters.
export const isValidAdminUsername = isValidUsername;
