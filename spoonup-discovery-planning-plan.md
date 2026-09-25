# SpoonUp — Discovery & Planning Implementation Plan
### Checklist items A (Market Research) & B (Site/App Information Architecture)

---

## 0. Purpose & Scope

This document delivers the two Discovery & Planning checklist items agreed with the founder before any implementation begins:

- **A.** Market research on comparable platforms (subscription + immediate + scheduled order models), covering page structures, checkout flows, and subscription management UX.
- **B.** The full site/app information architecture — pages, customer user flows, and admin flows — derived from that research.

This is a planning artifact, not a spec for engineering handoff yet. It is meant to be reviewed with the founder, per his own instruction, before wireframing or coding starts.

---

## Part A — Market Research

### A.1 Platforms studied

| Platform | Model type | Relevance to SpoonUp | Key takeaway |
|---|---|---|---|
| **Country Delight** | Wallet-funded daily/alternate-day subscription (milk, dairy, groceries) | Closest match to SpoonUp's dry-fruit + subscription bucket; operates in Bengaluru | Wallet is recharged in advance, but **billed only on successful delivery** — not deducted in a lump sum at signup. Supports vacation/pause mode and an 11:59 PM cutoff for next-day changes. Tiered "VIP membership" gives discount slabs. |
| **bbdaily (BigBasket)** / **DailyNinja** | Wallet-recharge, order-by-cutoff, next-morning delivery | Bengaluru-founded/operated; validates the exact "recharge wallet → order → fixed delivery window" pattern | Order by 10 PM, delivered before 8 AM. Simple, low-friction reorder UX because the wallet removes per-order payment friction. |
| **FreshMenu** | Own-kitchen, ~45-minute cooked-to-order delivery; also listed on Swiggy/Zomato | Direct match for SpoonUp's "immediate" bucket (smoothies, puddings, snacks) | Runs ~90% of orders through its own fleet while keeping aggregator listings for reach — same dual-channel strategy SpoonUp wants (Swiggy/Zomato + own app). |
| **Milkbasket / Otipy** (referenced pattern) | Smart-basket auto-reorder subscriptions with day-by-day editing | Useful for the "edit before cutoff" UX on recurring orders | Users see a rolling basket per day and can add/remove items before a nightly cutoff, rather than a rigid fixed subscription. |
| **General D2C wallet/subscription architecture** (industry pattern, not one company) | Wallet (1:1 with user) → WalletTransaction (append-only ledger) → TopUp (gateway-linked credit event) | Confirms the ledger-based wallet model is the standard, not a SpoonUp-specific invention | Balance should be a cached/derived value; the transaction log is the source of truth. |
| **General e-commerce split-shipment pattern** (Zalando, Ordoro, standard order-management systems) | Parent `Order` → child `SubOrder`/`Shipment`, each independently tracked | Direct precedent for "one cart, three product types, tracked separately" | Parent order carries payment; each sub-order carries its own fulfillment type and status, linked by `parent_order_id`. |

### A.2 Patterns worth adopting directly

1. **Wallet-funded, billed-on-fulfillment** (Country Delight pattern) — money is loaded into the wallet upfront, but the actual debit happens only when a delivery is confirmed, not when the subscription is created. This matches the founder's brief closely and is a proven, well-understood UX in this exact market.
2. **Cutoff time for changes** — a fixed nightly cutoff (e.g., 10 PM–11:59 PM) after which the next day's deliveries lock. Prevents last-minute changes from breaking sourcing/kitchen planning, and is used by every subscription-dairy competitor studied.
3. **Pause / vacation mode** — subscriptions should be pausable per date range without cancellation. This is a must-have, not a nice-to-have; every competitor offers it, and its absence is a common complaint in reviews of platforms that lack it.
4. **Dual-channel presence** — own app/site as the primary margin driver, Swiggy/Zomato as reach/acquisition channels (FreshMenu pattern), consistent with the founder's stated intent.
5. **Tiered membership/discount slabs** rather than ad-hoc discounting — cleaner to reason about than per-order negotiated pricing, and matches the founder's own rule of discounting by order count rather than duration.

### A.3 Page structures observed across researched platforms

Common structure across Country Delight, bbdaily, FreshMenu, and general D2C subscription+on-demand apps:

- Home / landing (hero, category tiles, trust signals)
- Category / product listing (filterable by product type)
- Product detail page (PDP) — variant selection (one-time vs. subscribe)
- Subscription builder (frequency, duration, delivery window)
- Cart (mixed cart support where the platform allows multiple product types)
- Checkout (address, slot/time selection, payment)
- Order confirmation
- Account home / dashboard (wallet balance prominent)
- My Orders (with sub-status per item where mixed fulfillment exists)
- My Subscriptions (separate from order history — manage frequency, pause, skip)
- Wallet (balance, recharge, transaction history)
- Referral
- Support / Contact / Legal pages (T&C, privacy, returns, shipping)

### A.4 Checkout flow patterns

The dominant pattern across all platforms studied:

1. Cart review → mixed cart items grouped visually by fulfillment type (even before backend order-splitting).
2. Delivery address selection/confirmation.
3. For immediate items: earliest available slot shown by default.
4. For scheduled items: explicit time picker.
5. For subscription items: no slot picker at checkout — the recurring schedule was already set during subscription creation; checkout here is really "activate/fund the subscription."
6. Payment step — if wallet balance covers the order, "Pay from wallet" is the default and fastest path; otherwise, gateway selection (Razorpay/Cashfree/CC Avenue) with a merged wallet + gateway payment option (wallet covers partial, gateway covers remainder).
7. Order confirmation screen shows a **single confirmation** even when the backend has created multiple sub-orders — this is the "one order, three parts" UX the founder specifically asked for.

### A.5 Subscription management UX patterns

Observed as consistent, low-friction affordances across Country Delight, bbdaily, and Milkbasket:

- **Subscription list screen** — active vs. paused, grouped by product.
- **Per-subscription detail** — next delivery date, frequency, wallet funding status, edit/pause/skip/cancel actions.
- **Skip next delivery** — without cancelling the whole subscription.
- **Pause for a date range** (vacation mode) — auto-resumes.
- **Swap/change product** within an active subscription rather than forcing cancel-and-recreate.
- **Low-balance nudges** — proactive prompt to top up wallet before a scheduled delivery would fail for insufficient funds.

---

## Part B — Site & App Information Architecture

### B.1 Customer-facing sitemap

```
Home
├── Categories
│   ├── Dry Fruits & Pantry (delivery-in-days)
│   ├── Ready-to-Eat (smoothies, puddings, snacks — immediate)
│   └── Subscriptions (recurring plans)
├── Product Detail Page (PDP)
│   ├── One-time purchase option
│   └── Subscribe option → Subscription Builder
├── Subscription Builder
│   ├── Frequency selection (daily / alternate days / weekly)
│   ├── Duration selection (1 / 2 / 3 months)
│   └── Price + discount preview
├── Cart (mixed: dry-fruit + immediate + subscription funding)
├── Checkout
│   ├── Address
│   ├── Slot/time selection (immediate & scheduled only)
│   └── Payment (wallet / gateway / split)
├── Order Confirmation
├── Account
│   ├── Dashboard (wallet balance, active subscriptions summary)
│   ├── My Orders (parent order → expandable sub-order statuses)
│   ├── My Subscriptions (pause / skip / swap / cancel)
│   ├── Wallet (balance, recharge, transaction history)
│   ├── Referral (code, bonus history)
│   ├── Addresses
│   └── Profile / Login (Google login first)
├── Support / Contact Us (wallet withdrawal requests routed here)
└── Legal
    ├── Terms & Conditions
    ├── Privacy Policy
    ├── Return Policy
    └── Shipping Policy
```

### B.2 Admin panel sitemap

```
Admin Dashboard
├── Orders
│   ├── All Orders (parent view)
│   └── Sub-Order Tracking (per fulfillment type: dry-fruit / immediate / scheduled)
├── Subscriptions
│   └── Active / paused / churned, per product
├── Products & Categories
│   └── Create/edit product, assign fulfillment type
├── Users
│   └── Per-user: order history, payment history, wallet ledger
├── Wallet & Payments
│   ├── Transaction ledger (global)
│   └── Manual adjustment / refund tool
├── Coupons
│   └── Create (single-user / cohort / global), usage tracking
├── Manual Order Entry (event/in-person sales)
│   └── Enter agreed price → auto-computed discount
├── Referral Program
│   └── Referral bonus rules, payout log
└── Content
    └── Legal pages, banners, brand assets
```

### B.3 Customer user flows

**Flow 1 — Mixed cart checkout (core flow)**
1. User adds a dry-fruit item, an immediate snack, and funds a subscription — all in one session.
2. Cart shows three groups.
3. Checkout: address once, slot/time only for the immediate item, payment once.
4. Backend creates one `Order` + three `SubOrder`s (dry-fruit, immediate, subscription-activation).
5. User sees one confirmation, and later one entry in "My Orders" that expands into three independently tracked statuses.

**Flow 2 — Subscription creation & funding**
1. User selects a subscription product → chooses frequency + duration.
2. System shows total cost and per-delivery discount.
3. User pays the full subscription amount → wallet is credited, and the amount is earmarked/locked against that subscription.
4. Each delivery day, a `SubOrder` is auto-generated and the wallet is debited only on confirmed delivery.
5. User can pause, skip, or cancel from "My Subscriptions" at any time before the nightly cutoff.

**Flow 3 — Scheduled order (same-day, future time)**
1. User selects an immediate-category product but chooses "Schedule for later" instead of "Deliver now."
2. User picks a delivery time (e.g., 8 PM).
3. Order is created as a `SubOrder` with `fulfillment_type = scheduled` and `scheduled_for` timestamp.
4. Kitchen/ops queue picks it up at the appropriate prep lead time before the scheduled slot.

**Flow 4 — Low wallet balance during active subscription**
1. System detects insufficient wallet balance ahead of a scheduled subscription delivery.
2. User is notified (push/SMS/email) to top up.
3. If not topped up before cutoff, that day's delivery is skipped automatically (not cancelled) and the subscription resumes normally once funded.

**Flow 5 — Referral**
1. User shares referral code/link.
2. New user signs up using the code.
3. On the new user's first successful order, referral bonus is credited to the referrer's wallet as a `WALLET_TXN` of type `referral_bonus`.

### B.4 Admin flows

**Flow 1 — Manual/negotiated order entry (event sales)**
1. Admin opens "Manual Order Entry," selects products/cart on behalf of the customer.
2. Admin enters the final agreed price.
3. System computes the difference between list price and agreed price and auto-applies it as a discount line on the order.
4. Order is created and tracked identically to a self-service order from that point on.

**Flow 2 — Coupon creation**
1. Admin creates a coupon and selects scope: single user / cohort / global.
2. System enforces single-use-per-user regardless of scope.
3. Usage is tracked per coupon in the admin dashboard.

**Flow 3 — Order/payment lookup for support**
1. Admin searches a user.
2. Sees full order history (not just active/live orders) and full wallet transaction ledger.
3. Can drill into any parent order to see sub-order-level status and any manual adjustments made against that user's wallet.

**Flow 4 — Wallet withdrawal (manual, email-triggered)**
1. User emails support requesting withdrawal (no in-app withdrawal button exists, by design).
2. Admin verifies and, if approved, creates a manual `WALLET_TXN` of type `manual_refund`/`withdrawal` against that user's wallet from the admin panel.
3. This is logged identically to any other transaction for audit purposes.

---

## Open questions for founder review

Carried over from the earlier analysis, plus one new item surfaced by this research pass:

1. Should subscriptions get their own dedicated top-level section in the app (beyond "My Subscriptions" under account), given how central they are to the business model?
2. Confirm exact cutoff time for next-day subscription/dry-fruit changes (competitors cluster around 10 PM–11:59 PM).
3. Confirm whether "pause/vacation mode" should be self-service in v1 or admin-assisted initially.
4. Confirm platform-specific pricing approach (Android/iOS/web) and who owns setting those margins.
5. New: advance wallet top-ups collected before delivery has accounting/GST implications (advance received vs. revenue recognized) — worth a short conversation with an accountant before the wallet model is finalized.

---

*Prepared as Discovery & Planning deliverable — Checklist items A & B. Next step: review with founder, incorporate feedback, then proceed to wireframes and technical architecture doc.*
