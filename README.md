# 📱 Event Order-Taking System (Production-Ready)

A secure, mobile-first web application designed for event food stalls, counters, and pop-up events with zero-trust customer order privacy and dual-mode Supabase PostgreSQL integration.

---

## ⚡ Quick Start

```bash
# 1. Start the production server (runs API & web app on port 5001)
npm start

# 2. Run automated end-to-end and security tests
npm test
```

- **Web App / Customer Menu**: `http://localhost:5001`
- **Staff / Admin Dashboard**: `http://localhost:5001` ➔ Click **Admin** (Default PIN: `1234`)

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
   - A verified Admin PIN (`x-admin-pin`).
4. **Probing Blocked**: If anyone tries to guess sequential numbers (`#101`, `#102`...) or other order IDs without the exact token, the server immediately returns **`403 Forbidden`**.
5. **Phone Number Masking**: Even for authorized customer receipts, phone numbers are masked (`+91 ••••••3210`) as an additional privacy barrier. Full numbers are visible only to verified Admins for WhatsApp pickup notifications.
6. **Order Status Mutation Lock**: Only verified Admins can mutate order status (`PATCH /api/orders/:id/status`). Regular users cannot alter order statuses.
7. **Brute-Force & Spam Rate Limiting**:
   - Max 10 admin login attempts per 15 minutes.
   - Max 30 orders per 5 minutes per IP.
   - General API rate limiting against denial-of-service.
8. **Timing-Safe PIN Comparison**: Uses `crypto.timingSafeEqual` with SHA-256 hashes to prevent side-channel timing attacks.

---

## 🗄️ Supabase PostgreSQL Setup (Optional / 1-Click)

The application features a **dual-mode database layer**:
- **Offline / Local Mode**: Default behavior. Uses fast, zero-dependency local storage.
- **Supabase Cloud Mode**: Seamlessly switches to Supabase PostgreSQL when `.env` credentials are provided.

### Step 1: Run SQL Schema in Supabase
1. Open your project on [supabase.com](https://supabase.com).
2. Go to **SQL Editor** ➔ **New Query**.
3. Copy and paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) and click **Run**.
4. This creates tables (`products`, `orders`, `settings`), sequences, indexes, and Row Level Security (RLS) policies.

### Step 2: Configure Environment Variables
Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```ini
PORT=5001
ADMIN_PIN=1234

SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
```

When you start the server (`npm start`), you will see:
```text
⚡ Connected to Supabase PostgreSQL at: https://your-project-id.supabase.co
```

---

## 📲 How Attendees Order at the Event

1. **Local Wi-Fi / Hotspot**:
   - Connect your laptop and attendee phones to the same Wi-Fi or hotspot.
   - Open **Admin Dashboard** ➔ **Settings & Standee**.
   - Enter your laptop's local IP (e.g. `http://192.168.1.15:5001`) and click **"Print Counter Standee Sign"**.
   - Display the printed standee at your counter. Attendees scan with their camera to order!

2. **Over Mobile Data (4G/5G)**:
   - Run `npx ngrok http 5001`.
   - Copy the public `https://...ngrok-free.app` URL into the standee settings and print.

---

## 💬 1-Click WhatsApp Pickup Notification

When the kitchen marks an order as **Ready**:
1. Click **"Ready & Ping"** or **"WhatsApp: Ready for Pickup"** on the admin order card.
2. WhatsApp opens immediately with the customer's phone number and the exact personalized receipt pre-filled:
   > *"Hello Aarav Patel! 👋 Your order #101 is READY FOR PICKUP! 🔔 Please show this token at the Main Counter. Enjoy! 🎉"*
3. Tap send with 1 click. Zero API fees, zero template delays, 100% reliable.
