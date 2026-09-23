import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_SESSION_SECRET = 'unit-test-session-secret-that-is-long-enough-32';
const security = await import('../../server/security.js');
const {
  hashPassword, verifyPassword, timingSafeCompare, createAdminSession, isValidAdminSession,
  revokeAdminSession, sanitizeHttpUrl, csvCell, isHashedSecret, isValidUsername, isValidEmail,
  escapeLikePattern, adminCredentialVersion, adminCredentialVersionFromSettings,
  isValidAdminUsername, MIN_ADMIN_PASSWORD_LENGTH
} = security;

test('hashPassword produces salted scrypt hashes that verify', async () => {
  const hash = await hashPassword('secret-pin');
  assert.ok(isHashedSecret(hash));
  assert.notEqual(hash, await hashPassword('secret-pin'), 'salt must differ per call');
  assert.equal(await verifyPassword('secret-pin', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('verifyPassword still accepts legacy plaintext values', async () => {
  assert.equal(await verifyPassword('1234', '1234'), true);
  assert.equal(await verifyPassword('1235', '1234'), false);
});

test('timingSafeCompare handles unequal lengths', () => {
  assert.equal(timingSafeCompare('a', 'a'), true);
  assert.equal(timingSafeCompare('a', 'ab'), false);
  assert.equal(timingSafeCompare(1, 'a'), false);
});

test('admin sessions are signed, bound to the credential, and revocable', () => {
  const settings = { adminUsername: 'spoonadmin', adminPassword: 'salt:hash-one' };
  const token = createAdminSession(settings);
  assert.ok(token.startsWith('adm_'));
  assert.equal(isValidAdminSession(token, settings), true);
  assert.equal(
    isValidAdminSession(token, { ...settings, adminPassword: 'salt:hash-two' }),
    false,
    'password rotation must invalidate'
  );
  assert.equal(
    isValidAdminSession(token, { ...settings, adminUsername: 'renamed' }),
    false,
    'username change must invalidate'
  );
  assert.equal(isValidAdminSession(token.slice(0, -2) + 'zz', settings), false, 'tampered signature');
  assert.equal(isValidAdminSession('adm_not-a-token', settings), false);
  assert.equal(isValidAdminSession('', settings), false);
  revokeAdminSession(token);
  assert.equal(isValidAdminSession(token, settings), false, 'revoked');
});

test('credential fingerprint is case-insensitive on username and covers both fields', () => {
  const a = adminCredentialVersion('SpoonAdmin', 'salt:hash');
  const b = adminCredentialVersion('spoonadmin', 'salt:hash');
  assert.equal(a, b, 'username comparison is case-insensitive');
  assert.notEqual(a, adminCredentialVersion('spoonadmin', 'salt:other'));
  assert.notEqual(a, adminCredentialVersion('other', 'salt:hash'));
  assert.equal(
    adminCredentialVersionFromSettings({ adminUsername: 'spoonadmin', adminPassword: 'salt:hash' }),
    a
  );
});

test('forged and legacy PIN-scheme tokens are rejected', () => {
  const settings = { adminUsername: 'spoonadmin', adminPassword: 'salt:hash' };
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 60000, cv: 'whatever', n: 'x' })).toString('base64url');
  assert.equal(isValidAdminSession(`adm_${forged}.bogus`, settings), false, 'unsigned payload');
  // A token from the old scheme carries `pv` instead of `cv` and must not validate.
  const legacy = createAdminSession({ adminUsername: 'x', adminPassword: 'y' });
  assert.equal(isValidAdminSession(legacy, settings), false);
});

test('admin username and password rules', () => {
  assert.equal(isValidAdminUsername('spoonadmin'), true);
  assert.equal(isValidAdminUsername('ad'), false);
  assert.equal(isValidAdminUsername('bad name'), false);
  assert.equal(isValidAdminUsername('drop%table'), false);
  assert.equal(MIN_ADMIN_PASSWORD_LENGTH, 8);
});

test('sanitizeHttpUrl allows only https without credentials', () => {
  assert.equal(sanitizeHttpUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(sanitizeHttpUrl('http://example.com/a.png'), '');
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeHttpUrl('https://user:pass@example.com/'), '');
  assert.equal(sanitizeHttpUrl('not a url'), '');
});

test('csvCell neutralises formula injection and quotes', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('+1'), '"\'+1"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell(null), '""');
});

test('username and email validation', () => {
  assert.equal(isValidUsername('john_1'), true);
  assert.equal(isValidUsername('jo'), false);
  assert.equal(isValidUsername('john%'), false);
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('nope'), false);
});

test('escapeLikePattern neutralises wildcards', () => {
  assert.equal(escapeLikePattern('j_hn%\\'), 'j\\_hn\\%\\\\');
  assert.equal(escapeLikePattern('plain'), 'plain');
});
