import crypto from 'crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password).trim(), salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(candidate, storedHash) {
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
      const derivedKey = crypto.scryptSync(trimmedCandidate, salt, 64);
      const keyBuffer = Buffer.from(keyHex, 'hex');
      if (derivedKey.length !== keyBuffer.length) return false;
      return crypto.timingSafeEqual(derivedKey, keyBuffer);
    } catch {
      return false;
    }
  }

  const hashInput = crypto.createHash('sha256').update(trimmedCandidate).digest();
  const hashTarget = crypto.createHash('sha256').update(trimmedStored).digest();
  return crypto.timingSafeEqual(hashInput, hashTarget);
}

export function timingSafeCompare(input, target) {
  if (typeof input !== 'string' || typeof target !== 'string') return false;
  const a = Buffer.from(crypto.createHash('sha256').update(input.trim()).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(target.trim()).digest());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAdminSession() {
  const token = `adm_${crypto.randomBytes(32).toString('hex')}`;
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

export function revokeAdminSession(token) {
  if (token) adminSessions.delete(token);
}

export function sanitizeImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString().slice(0, 500);
  } catch {
    return '';
  }
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@|]/.test(text) || text.startsWith('\t') || text.startsWith('\r')) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function isHashedSecret(value) {
  return typeof value === 'string' && value.includes(':');
}

export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createUserSessionToken() {
  return `usr_${crypto.randomBytes(32).toString('hex')}`;
}

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,32}$/.test(String(username || '').trim());
}

export function isValidEmail(email) {
  const value = String(email || '').trim();
  return value.length >= 5 && value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function sanitizeTrackingUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString().slice(0, 500);
  } catch {
    return '';
  }
}
