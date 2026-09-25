# 📱 Event Order-Taking System (Production-Ready)

A secure, mobile-first web application designed for event food stalls, counters, and pop-up events with zero-trust customer order privacy and dual-mode Supabase PostgreSQL integration.

---

## ⚡ Quick Start

```bash
# 1. Start the production server (runs API & web app on port 5001)
npm start

# 2. Run unit, end-to-end and security tests
npm test
```

Tests: `npm run test:unit` (Node's built-in runner, `test/unit/`), then `run-all-tests.js` boots an isolated server on port 5002 in local-JSON mode and runs `test-e2e.js` + `test-security.js`. CI runs lint, audit, build and tests on every push (`.github/workflows/ci.yml`).

- **Web App / Customer Menu**: `http://localhost:5001`
- **Staff / Admin Dashboard**: `http://localhost:5001/admin` — log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`.
  If `ADMIN_PASSWORD` is not set, a random password is generated and printed once at first start (there is no default password).

---

## 🛡️ Zero-Trust Security & "No Neighboring Order" Protection

### The Problem (IDOR in Event Apps)
In typical event order systems, order numbers are sequential (`#101`, `#102`, `#103`). Without access control, customer A who placed order `#101` could change their browser URL to inspect `#102` or `#103` and snoop on another attendee's:
- Full Name
- WhatsApp Phone Number
- Items ordered & dietary notes
- Total spent

### How This App Solves It
1. **Unguessable 256-Bit Secret Tokens**: Every order generates an unguessable token (`order_sec_...` via `crypto.randomBytes(24)`).
2. **Device Isolation**: The secret token is sent **only once** to the customer's phone upon order placement and stored locally in their browser session (`order_tokens`).
3. **Strict Order Authorization**: `GET /api/orders/:id` requires **either**:
   - A valid matching `x-order-token` header, OR
   - A signed admin session token (`x-admin-token: adm_…`, issued by `POST /api/admin/login`), OR
   - The logged-in customer who placed it.
4. **Probing Blocked**: If anyone tries to guess sequential numbers (`#101`, `#102`...) or other order IDs without the exact token, the server immediately returns **`403 Forbidden`**.
5. **Phone Number Masking**: Even for authorized customer receipts, phone numbers are masked (`+91 ••••••3210`) as an additional privacy barrier. Full numbers are visible only to verified Admins for WhatsApp pickup notifications.
6. **Order Status Mutation Lock**: Only verified Admins can mutate order status (`PATCH /api/orders/:id/status`). Regular users cannot alter order statuses.
7. **Brute-Force & Spam Rate Limiting**:
   - Max 5 *failed* admin login attempts per 15 minutes; raw credentials are **only** accepted by `/api/admin/login`, never by other routes.
   - Max 20 invalid admin tokens per 15 minutes; max 10 customer auth attempts per 15 minutes.
   - Max 30 orders per 5 minutes per IP; general API limit of 300 requests/minute.
   - Behind Cloudflare, set `ORIGIN_AUTH_SECRET` so limits key on the real client IP (`CF-Connecting-IP`).
8. **Timing-Safe Comparisons & Async Hashing**: Admin and customer passwords use async scrypt (never blocks the event loop); every secret comparison uses `crypto.timingSafeEqual`.
9. **Stateless Signed Admin Sessions**: HMAC-signed tokens (`ADMIN_SESSION_SECRET`) that survive restarts and multiple instances, expire after 12 h, and are revoked by logout or any change to the admin username or password.
10. **Idempotent Payments**: a checkout is atomically claimed before orders are created and a unique index on `(razorpay_payment_id, fulfillment_type)` guarantees one order per payment even when the Razorpay webhook and the browser race.

---

## 🗄️ Supabase PostgreSQL Setup (Optional / 1-Click)

The application features a **dual-mode database layer**:
- **Offline / Local Mode**: Default behavior. Uses fast, zero-dependency local storage.
- **Supabase Cloud Mode**: Seamlessly switches to Supabase PostgreSQL when `.env` credentials are provided.

### Step 1: Run SQL Schema in Supabase
1. Open your project on [supabase.com](https://supabase.com).
2. Go to **SQL Editor** ➔ **New Query**.
3. Copy and paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) and click **Run**.
4. This creates tables (`products`, `orders`, `settings`, `users`, `user_sessions`, `checkouts`), sequences, indexes, and Row Level Security (RLS) policies.
5. **Existing projects**: also run [`supabase/migrate-security-hardening.sql`](./supabase/migrate-security-hardening.sql) and [`supabase/migrate-admin-credentials.sql`](./supabase/migrate-admin-credentials.sql) once (both idempotent).

> Production refuses to start without Supabase: the local JSON file is for development only.

### Step 2: Configure Environment Variables
Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with a strong staff login (required before public use):

```ini
PORT=5001
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-before-going-live # min 8 characters
ADMIN_SESSION_SECRET=<openssl rand -hex 32>
ORIGIN_AUTH_SECRET=<openssl rand -hex 32>    # same value in the Cloudflare Worker secret

SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
```

When you start the server (`npm start`), you will see:
```text
⚡ Connected to Supabase PostgreSQL at: https://your-project-id.supabase.co
```

---

## 📲 How Attendees Order at the Event

Pick the option that matches how you are hosting the app.

1. **Laptop at the counter, same Wi-Fi / hotspot** (no ngrok needed):
   - Connect your laptop and attendee phones to the same Wi-Fi or hotspot.
   - Open **Admin Dashboard** ➔ **Settings & Standee**.
   - Enter your laptop's local IP (e.g. `http://192.168.1.15:5001`) and click **"Print Counter Standee Sign"**.
   - Display the printed standee at your counter. Attendees scan with their camera to order!
   - Limitation: phones on mobile data cannot reach a private `192.168.x.x` address.

2. **Laptop at the counter, attendees on mobile data** (ngrok as a temporary tunnel):
   - Run `npx ngrok http 5001` and set `TRUST_PROXY=true` in `.env` so rate limits see real client IPs.
   - Copy the public `https://...ngrok-free.app` URL into the standee settings and print.
   - This is a stopgap for laptop hosting, **not** a deployment method: the URL changes on
     every restart, the free tier is rate limited, and your laptop must stay awake and online.

3. **Real deployment** (recommended for anything recurring — ngrok is not involved):
   - Deploy to any Node host (Render, Railway, Fly.io, a VPS behind Nginx, etc.).
   - Run `npm run build` then `npm start`, set `ADMIN_USERNAME`/`ADMIN_PASSWORD` and the Supabase variables,
     and set `TRUST_PROXY=true` because you are behind the platform's proxy.
   - Terminate HTTPS at the platform/reverse proxy and point your own domain at it.

---

## 💬 1-Click WhatsApp Pickup Notification

When the kitchen marks an order as **Ready**:
1. Click **"Ready & Ping"** or **"WhatsApp: Ready for Pickup"** on the admin order card.
2. WhatsApp opens immediately with the customer's phone number and the exact personalized receipt pre-filled:
   > *"Hello Aarav Patel! 👋 Your order #101 is READY FOR PICKUP! 🔔 Please show this token at the Main Counter. Enjoy! 🎉"*
3. Tap send with 1 click. Zero API fees, zero template delays, 100% reliable.
