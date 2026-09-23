-- =========================================================================
-- SpoonUp: replace the shared admin PIN with a username + password login
-- Paste into Supabase → SQL Editor → Run BEFORE deploying the matching build.
-- Safe to re-run (IF NOT EXISTS / IF EXISTS).
-- =========================================================================

-- 1) New credential columns. admin_password stays NULL until the server
--    bootstraps it from ADMIN_PASSWORD on first start, so there is never a
--    well-known default password sitting in the schema.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_username TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_password TEXT;

-- 2) The old PIN is deliberately NOT migrated into admin_password: a 6-digit
--    PIN is not an acceptable password, and promoting it would silently carry a
--    weak credential forward. Set ADMIN_PASSWORD in the environment once; the
--    server hashes it on first read and the Settings screen owns it afterwards.
ALTER TABLE settings DROP COLUMN IF EXISTS admin_pin;

-- 3) Usernames are compared case-insensitively.
ALTER TABLE settings
  ADD CONSTRAINT settings_admin_username_not_blank
  CHECK (length(btrim(admin_username)) >= 3) NOT VALID;
ALTER TABLE settings VALIDATE CONSTRAINT settings_admin_username_not_blank;

ANALYZE settings;
