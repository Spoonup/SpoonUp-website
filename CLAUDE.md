# CLAUDE.md — SpoonUp Event Order System

Mobile-first food ordering app for SpoonUp (healthy sweets, snacks, Kashmiri dry fruits).
Customers scan a QR standee → browse menu → order (pay at counter via UPI, or online via
Razorpay). Staff use a password-protected dashboard for live kitchen orders, menu/stock,
deliveries, and settings. Live at `https://spoonupfoods.com` (Cloudflare Worker → Cloud Run,
`asia-south1`).

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`) | Plain `.jsx`, **no TypeScript**, no router lib |
| Icons / FX | `lucide-react`, `canvas-confetti`, `node-emoji` | |
| Backend | Node 22, Express 5, ESM (`"type": "module"`) | `express-rate-limit`, `cors`, `dotenv` |
| Database | Dual-mode: Supabase Postgres **or** local `data/db.json` | Switched by env vars at boot; see below |
| Payments | Razorpay (raw `fetch` to REST API, no SDK, 8 s timeout) | HMAC signature + webhook verification |
| Images | Google Cloud Storage (`@google-cloud/storage`) | Only when `PRODUCT_IMAGE_BUCKET` is set; magic-byte validated |
| Lint | `oxlint` (`.oxlintrc.json`: react + oxc plugins; unused vars & hook deps are **errors**) | |
| Tests | `node --test` unit tests in `test/unit/` + integration scripts with `node:assert` | CI: `.github/workflows/ci.yml` |
| Deploy | Docker (multi-stage, `node:22-alpine`, healthcheck) → Cloud Run; Cloudflare Worker proxies apex | |

## Commands

```bash
npm run dev:all   # Vite (5173, proxies /api → 5001) + API server together — use this for dev
npm run dev       # Vite only
npm run server    # API only (node server/index.js)
npm run build     # vite build → dist/
npm start         # NODE_ENV=production; serves dist/ + API on PORT (default 5001)
npm test          # unit tests, then spawns server on :5002 in local-JSON mode and runs test-e2e.js + test-security.js
npm run test:unit # node --test test/unit/*.test.js (pure modules only, hermetic)
npm run lint      # oxlint — must be clean (0 warnings)
npm run preview   # vite preview of dist/
```

- `npm test` forces Supabase/Razorpay env **empty**, `ADMIN_USERNAME=spoonadmin` / `ADMIN_PASSWORD=test-admin-password`, a fixed `ADMIN_SESSION_SECRET`, and `RAZORPAY_WEBHOOK_SECRET=test-webhook-secret`; it never touches the cloud DB.
- Deploy: `deploy/gcp-cloud-run.sh` (reads `.env`, pushes secrets to Secret Manager, `gcloud run deploy --source .`). Non-secret runtime env lives in `deploy/cloud-run-env.yaml`.
- Supabase setup: paste `supabase/schema.sql` into the SQL editor (idempotent). `migrate-auth-payments.sql`, `migrate-security-hardening.sql`, `migrate-admin-credentials.sql` and `indexes.sql` are also re-runnable. **Run `migrate-security-hardening.sql` and `migrate-admin-credentials.sql` before deploying this build** — the second replaces `settings.admin_pin` with `admin_username` / `admin_password`.

## Repository layout

```
index.html, vite.config.js      Vite entry; dev proxy /api → http://localhost:5001
src/main.jsx                    createRoot + StrictMode
src/index.css                   Tailwind import + @theme brand tokens + body defaults
src/App.jsx                     Top-level state, hand-rolled routing (parseRoute/navigateTo), header/nav
src/components/
  CustomerMenu.jsx              Menu, cart, checkout (counter/online), delivery address form
  OrderStatus.jsx               Customer order tracker (polls every 4s)
  UserAuthModal.jsx             Customer signup/login
  AdminLoginModal.jsx           Staff username + password login
  AdminOrders.jsx               Kitchen queue (polls every 4s, chime on new order, WhatsApp ping)
  AdminProducts.jsx             Menu CRUD + image upload
  AdminDeliveries.jsx           Deliver-later orders (shipped/delivered/tracking link)
  AdminSettings.jsx             Event name, admin login, counter name, UPI, QR standee printing
src/utils/whatsapp.js           Builds "order ready" WhatsApp message + api.whatsapp.com URL
src/utils/audio.js              Web Audio chime
src/lib/money.js                Client mirror of server/tax.js (cartTotals)
src/lib/adminSession.js         adminFetch() (adds token, fires session-expired event on 401), storage helpers
src/hooks/useAdminOrders.js     Shared 4 s polling loop for AdminOrders/AdminDeliveries (orders, stats, updateStatus)
server/index.js                 Express app: security headers, CORS, body parsing, rate limits, ALL routes, static fallback
server/db.js                    Repository layer: every db* fn branches on isSupabaseActive(); local JSON fallback; seed data
server/supabase.js              Supabase client + snake_case ↔ camelCase mappers
server/security.js              async scrypt hashing, timing-safe compare, HMAC-signed stateless admin sessions (credential-versioned), URL/CSV/LIKE sanitizers
server/checkout.js              Cart verification, GST totals, split immediate/delivery orders, idempotent paid fulfilment
server/webhooks.js              Razorpay webhook event handling (captured / failed / refund)
server/razorpay.js              Razorpay REST calls + signature verification
server/tax.js                   GST helpers (normalizeGstRate, roundMoney, calculateLineTax)
server/storage.js               GCS product image upload + managed-URL check
supabase/*.sql                  Schema, migration, indexes (all idempotent)
deploy/                         Cloud Run script, env yaml, Cloudflare Worker
test/unit/*.test.js             node:test unit tests (tax, security, checkout helpers)
test-e2e.js, test-security.js   Integration tests hitting a running server
run-all-tests.js                Test orchestrator used by `npm test`
data/db.json                    Local DB (gitignored, auto-created from INITIAL_DATA)
```

## Architecture & domain rules

### Dual-mode database
- `server/db.js` is the **only** place the rest of the server should talk to storage. Add a
  `dbXxx()` function there and, if Supabase is active, a matching `fetch/insert/updateSupabaseXxx()`
  in `server/supabase.js` **plus** the local-JSON branch. Both paths must return the same
  camelCase shape.
- Supabase columns are `snake_case`; JS objects are `camelCase`. Mapping lives in
  `mapSupabaseProduct` / `mapSupabaseOrder` / etc. Adding a field means: SQL migration →
  mapper → local branch → route validation → UI.
- Local JSON writes are atomic (`.tmp` + rename). `normalizeDb()` backfills older records.
- The server uses the **service role key**; RLS revokes `anon`/`authenticated` entirely.
  Browsers never talk to Supabase directly. Every PostgREST call has a 10 s timeout.
- **Production refuses to start without Supabase** (`server/index.js` startup guard), and
  `fetchSupabaseSettings` throws rather than falling back to local JSON.
- User lookups go through `escapeLikePattern()` before `ilike` — never pass raw input to a pattern filter.

### Auth model
- **Admin:** username + password → `POST /api/admin/login` (5 *failed* attempts / 15 min) →
  `adm_<payload>.<hmac>` stateless token signed with `ADMIN_SESSION_SECRET` (12 h; carries
  `adminCredentialVersion(username, passwordHash)` so changing **either** field revokes every
  session; `POST /api/admin/logout` adds it to a per-instance denylist). Sent as `x-admin-token`
  (preferred), `x-admin-pin` (legacy alias, still accepted), or `Authorization: Bearer adm_…`.
  **Raw credentials are never accepted on any other route** — `authenticateAdmin`/`checkIsAdmin`
  validate tokens only and throttle invalid ones (20 / 15 min per IP). The password is
  async-scrypt-hashed (`salt:hash`), 8–128 chars, and **never returned**. The username is
  3–32 `[A-Za-z0-9_]`, compared case-insensitively, and returned **only to an authenticated
  admin** (`publicSettings(s, { includeAdminFields })`) — it is half the credential.
  Changing the username or password requires re-sending `currentPassword` (403
  `CURRENT_PASSWORD_REQUIRED` otherwise), so a stolen token alone cannot lock staff out.
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` only bootstrap while no password is stored; a local DB with
  neither gets a random printed password, and Supabase mode hard-fails instead of inventing one.
  The old `adminPin` field is dropped on read and is never promoted to a password.
- **Customer:** username/password (scrypt) → `usr_<hex>` token (30 days, persisted in DB). Sent as
  `x-user-token` or Bearer. Guests order without an account.
- **Order access (zero-trust / anti-IDOR):** every order has `accessToken = order_sec_<48 hex>`.
  `GET /api/orders/:id` succeeds only with a matching `x-order-token`, an admin credential, or
  a logged-in owner (`order.userId`). Everything else → **404** (not 403). Non-admins get a
  masked phone. `publicOrder()` strips `accessToken` from admin list responses.
- Client stores: `localStorage.admin_session`, `user_session`, `my_orders`, `order_tokens`
  (`{orderId: token}`). Never store raw admin credentials client-side.

### Orders, checkout, payments
- **Prices and tax are always computed server-side** (`verifyCartItems` → `calculateLineTax`).
  The client sends only `{id, quantity}`; ignore any client-supplied price/total.
- Per-product `gstRate` (default 5, 0–100). Orders store `subtotalAmount`, `taxAmount`,
  `totalAmount`; each line stores `baseAmount`, `taxAmount`, `subtotal`. Use `roundMoney()`.
- A cart containing any `deliverLater` product is **split into two orders** (`fulfillmentType`
  `immediate` + `delivery`) sharing a `paymentGroupId`. Delivery orders require a normalized
  `deliveryAddress`; the API signals this with `code: 'NEEDS_DELIVERY_ADDRESS'`.
- Status vocabularies differ by fulfilment type (enforced in `PATCH /api/orders/:id/status`):
  - kitchen: `pending → preparing → ready → completed` (+ `cancelled`)
  - delivery: `pending → shipped → delivered` (+ `rejected`, `refunded`, `cancelled`)
  - Moving a counter order to `preparing` marks it `paid`; `refunded` sets `paymentStatus`.
- **Counter flow:** `POST /api/orders` (or `checkout/prepare` + `complete` with `paymentMethod:'counter'`).
- **Online flow:** `POST /api/checkout/prepare` (delivery address is **required here** when the cart
  has deliver-later items — money never moves before the address exists) creates a `checkouts` row +
  Razorpay order → client opens Razorpay Checkout.js → `POST /api/checkout/complete` verifies
  `HMAC(orderId|paymentId)` → `fulfillPaidCheckout()`. The webhook (`/api/webhooks/razorpay`, raw
  body, HMAC-verified, exempt from the general limiter and origin auth) can also fulfil.
- **Concurrency rule:** `fulfillPaidCheckout` (and the counter path in `complete`) first calls
  `claimCheckoutForFulfillment()` → `dbClaimCheckout()` (conditional `UPDATE … WHERE status IN (…)`).
  Only the winner creates orders; losers get the existing orders (completed) or a 409
  `CHECKOUT_IN_PROGRESS` (webhook answers 503 so Razorpay retries). A partial unique index on
  `orders(razorpay_payment_id, fulfillment_type)` is the last line of defence; `insertSupabaseOrder`
  turns a `23505` into a re-fetch. Keep all of this when touching checkout.
- `checkouts.created_orders` holds **references** (`{id, fulfillmentType}`) only; use
  `loadCheckoutOrders()` to get full orders. `open` checkouts expire after 30 min (`isCheckoutExpired`).
- Checkout statuses: `open → fulfilling → paid/completed | failed | cancelled`.
- The client persists `pending_checkout` in localStorage after `prepare` for online payments and
  retries `complete` on the next visit (webhook-paid checkouts complete without a signature).
- In `NODE_ENV=test`, online checkout works without Razorpay keys (fake `order_test_…` id).

### HTTP layer conventions (`server/index.js`)
- Routes are grouped under `// ----------------- SECTION -----------------` banners. Keep
  new routes in the matching section; the static/SPA fallback must stay last.
- Every handler: `try { … } catch (err) { sendError(res, err, 'Generic fallback.', 'Context'); }`.
  `sendError` exposes `err.message` **only** when `err.status` is set (a domain error); anything
  else is logged and the fallback string is sent. Error responses are always `{ error }` (+ `code`).
- Throw domain errors as `const err = new Error(msg); err.status = 400; err.code = 'X'; throw err;`.
- Privileged mutations call `auditLog(req, 'entity.action', {...})` (one JSON line to stdout).
- Validate and clamp every input inline (`String(x).trim().slice(0, N)`, numeric ranges).
  Existing limits: name 2–60, phone 8–18 digits, notes 250, product name 80, description 300,
  price 0–100000, cart ≤ 50 items, qty 1–50.
- Rate limiters (all keyed by `clientKey(req)`): admin login 5 failures/15 min, invalid admin tokens
  20/15 min, user auth 10/15 min, order creation 30/5 min, general `/api` 300/min. Set
  `TRUST_PROXY=true` behind any proxy. With `ORIGIN_AUTH_SECRET` set, requests must carry
  `X-Origin-Auth` (added by the Worker) except `/api/health` and the webhook, and
  `CF-Connecting-IP` becomes `req.clientIp`.
- `/api/*` responses are `Cache-Control: no-store`; `dist/assets/*` are immutable.
- Body parsing is per-path: webhook = raw `*/*` 256 kb, image upload = raw `image/*` 5 mb,
  everything else JSON 64 kb.
- CSP is set in code; if you add an external script/connect origin, update the header.
- Sanitize any URL stored from user input with `sanitizeImageUrl` / `sanitizeTrackingUrl`
  (http/https only, no credentials). CSV export must go through `csvCell()`.
- Use `crypto.timingSafeEqual` (via `timingSafeCompare`/`verifyPassword`) for secrets — never `===`.

### Frontend conventions
- One top-level `App.jsx` owns global state (settings, products, cart, current user/admin) and
  passes props down. No Redux/context; no react-router — routes are `/`, `/status`,
  `/admin/{orders,products,deliveries,settings}` via `parseRoute` + `history.pushState`.
- Components are default-exported function components, one per file, `PascalCase.jsx`.
  Hooks + handlers at the top, JSX below. Handlers are `handleXxx`; callbacks passed as props
  are `onXxx`.
- Customer data fetching is plain `fetch('/api/...')`; relative URLs (Vite proxy in dev, same origin
  in prod). Admin screens use `useAdminOrders(adminToken)` for polling and `adminFetch(url, token,
  opts)` for one-off calls — it adds `x-admin-pin` and fires `ADMIN_SESSION_EXPIRED_EVENT` on 401,
  which `App.jsx` turns into a forced re-login. Never call `fetch` with `x-admin-pin` directly.
- Cart totals come from `src/lib/money.js` (`cartTotals`), mirroring `server/tax.js`.
- UPI details (`settings.upiId`, `settings.upiPhone`) are admin-configured, never hard-coded.
- Avoid `setState` inside effects (lint error): derive during render, use lazy `useState(init)`, or
  defer network kicks with `setTimeout(fn, 0)` / `Promise.resolve().then(fn)` as in `App.jsx`.
- Styling is Tailwind utility classes inline. Brand palette (also in `@theme` in `index.css`):
  forest `#013e37` (primary/text), forest-light `#06554c` (hover), butter `#ffefb3`
  (accent/CTA text on forest), canvas `#faf9f5` (page bg), border `#e8e5dc`, card `#ffffff`.
  Rounded-full pills for nav/buttons, `rounded-xl/2xl/3xl` for cards, `text-xs font-semibold`
  for controls. Keep it mobile-first.
- Icons come from `lucide-react` with explicit `size={n}`.

## Code style

- 2-space indent, single quotes, semicolons in server code and components (`main.jsx` and
  `vite.config.js` omit them — leave those as-is). Trailing commas not required.
- ESM everywhere (`import`/`export`), `.js` extension in server import paths.
- `camelCase` for variables/functions, `PascalCase` for components, `UPPER_SNAKE` for
  module constants (`SESSION_TTL_MS`, `DEFAULT_GST_RATE`).
- Prefix intentionally-unused vars with `_` (`const { accessToken: _accessToken, ...safe }`).
- Comments: short `//` explaining *why*; JSDoc only on shared util functions. Match the
  existing density — don't over-comment.
- Log with prefixed tags: `console.error('[Checkout Prepare Error]', err)`,
  `console.warn('⚠️ …')`, `console.log('⚡ …')`.
- IDs: `prod-`, `ord-`, `chk-`, `pay-` + `crypto.randomUUID()`; tokens `adm_`/`usr_`/`order_sec_` + hex.
- Timestamps are ISO strings (`new Date().toISOString()`).

## Testing

- `test-e2e.js` and `test-security.js` are sequential scripts using `assert` against a live
  server (`BASE_URL` from `PORT`). Add new checks as numbered `console.log('N. Testing …')`
  blocks with `assert.*` and a `   ✓ …` success line, following the existing pattern.
- Security tests cover: IDOR on neighbouring orders, token/PIN auth, rate limits, status
  mutation lock, phone masking, webhook signature, CSV injection. Any change to auth,
  order access, or payments must keep these green.
- Unit tests live in `test/unit/*.test.js` (Node's `node:test`); keep them hermetic (set
  `SUPABASE_URL=''` before importing anything that pulls in `db.js`).
- Run `npm test` before committing server changes and `npm run lint` for any change; both must be
  fully clean (lint has zero tolerance for unused vars / missing hook deps).

## Environment variables

| Var | Purpose |
|---|---|
| `PORT` | API port (5001 local, 8080 in Docker/Cloud Run) |
| `NODE_ENV` | `production` enables strict CORS; `test` relaxes Razorpay requirement |
| `ADMIN_USERNAME` | Bootstrap staff username, 3–32 chars (defaults to `admin`; only used until one is stored) |
| `ADMIN_PASSWORD` | Bootstrap staff password, min 8 chars (only used until one is stored) |
| `ADMIN_SESSION_SECRET` | ≥32 chars; signs admin session tokens (without it sessions are per-process) |
| `ORIGIN_AUTH_SECRET` | ≥32 chars; shared with the Cloudflare Worker (`wrangler secret put`) — enforces Worker-only access + real client IPs |
| `TRUST_PROXY` | `true` behind ngrok/Cloud Run/Cloudflare |
| `CORS_ORIGINS` | Comma list of allowed cross-origin browser origins |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Enables Supabase mode (both required) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Enables online payments |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC secret |
| `PRODUCT_IMAGE_BUCKET` | GCS bucket; when set, product images **must** be uploaded via `/api/products/images` |

`.env` is gitignored and must never be committed or printed. `.env.example` is the template.
Cloud Run gets secrets from Secret Manager: `deploy/gcp-cloud-run.sh` pushes them from `.env` via
stdin (no shell interpolation) and refuses short secrets / short PINs.

## Gotchas

- Admin sessions survive restarts only when `ADMIN_SESSION_SECRET` is set everywhere; the logout
  denylist is per-instance (tokens also expire on their own and die on any credential change).
- `AdminSettings.jsx` is Prettier-formatted (double quotes) while the rest of `src/` uses single
  quotes — match whichever file you are editing rather than reformatting it.
- The server serves `dist/`; run `npm run build` before `npm start` or you get the
  "Backend API is active" fallback text instead of the app.
- Supabase read helpers throw on error (no silent local fallback); a 5xx with `[… Error]` in the
  logs is the signal.
- `GET /api/orders` returns at most `limit` rows (default 500, max 1000) and supports `?since=`.
- `order_number` comes from a Postgres sequence in Supabase mode and a counter in local mode;
  both start at 101.
- Razorpay Checkout.js loads from `https://checkout.razorpay.com` — already allow-listed in CSP.
- The `www.` host is 301-redirected to the apex by the Cloudflare Worker; `Host` is rewritten
  to the Cloud Run origin, so same-origin CORS checks rely on `CORS_ORIGINS`.
