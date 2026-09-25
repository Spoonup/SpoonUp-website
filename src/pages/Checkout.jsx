import React, { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import Container from '../components/layout/Container';
import Pill from '../components/ui/Pill';
import Field from '../components/ui/Field';
import { ORDER_TYPES } from '../lib/orderTypes';
import { useCart } from '../lib/useCart';
import { useCatalogue } from '../lib/useCatalogue';
import { useUser } from '../lib/useUser';
import { api, rememberOrders } from '../lib/api';
import { rupees, getProduct } from '../data/catalogue';
import { cartTotals } from '../lib/money';


const KITCHEN_SLOTS = [
  'Today 7–8 pm',
  'Today 8–9 pm',
  'Today 9–10 pm',
  'Tomorrow 8–9 am'
];

// The server only knows two ways to take money: Razorpay (online) and counter
// (pay on handover). The gateway picks UPI/card/netbanking itself, so listing
// them here promised choices this checkout never made.
const PAYMENT_METHODS = [
  { id: 'razorpay', label: 'Pay online', note: 'UPI, card or netbanking via Razorpay' },
  { id: 'cod', label: 'Cash on delivery', note: 'Pay the rider or at the counter' }
];

function Step({ n, title, children, right }) {
  return (
    <section className="border-t border-line-10 pt-8 first:border-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-[16px] font-medium text-ink m-0">
          <span className="text-almond font-normal">{n} · </span>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function Checkout() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { settings } = useCatalogue();
  const { kitchen, pantry, plans, kitchenTotal, pantryTotal, plansTotal, count, clear } =
    useCart();

  const [name, setName] = useState(user?.username || '');
  // Guests must supply a contact number because the server requires one on every
  // order; a signed-in customer already has one on their account. There is no OTP
  // step anywhere -- nothing verifies this number yet.
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [address, setAddress] = useState({ line1: '', landmark: '', city: 'Bengaluru', pincode: '' });
  const [pantrySameAddress, setPantrySameAddress] = useState(true);
  const [kitchenMode, setKitchenMode] = useState('asap');
  const [kitchenSlot, setKitchenSlot] = useState(KITCHEN_SLOTS[0]);
  const [payment, setPayment] = useState('razorpay');
  const [placing, setPlacing] = useState(false);
  const [offerCod, setOfferCod] = useState(false);

  // Redirect declaratively — navigating during render is a React anti-pattern.
  // `placing` suppresses it while the order is being submitted, otherwise clearing
  // the cart would bounce us back to /cart before the confirmation route lands.
  if (count === 0 && !placing) return <Navigate to="/cart" replace />;

  // Totals must match what the server will charge, or the button promises one
  // number and Razorpay takes another. cartTotals mirrors server/tax.js exactly:
  // per-product GST on the line items, and nothing else. Delivery fees and
  // coupons are not applied server-side, so they are not in this total.
  const sellable = [...kitchen, ...pantry].map((r) => ({
    price: r.unitPrice,
    quantity: r.qty,
    gstRate: r.gstRate ?? 5
  }));
  const { subtotalAmount, taxAmount, totalAmount } = cartTotals(sellable);
  const gst = taxAmount;
  const total = totalAmount;

  // What actually has to be true before the server will accept this order.
  const contactPhone = (user?.phone || '').replace(/\D/g, '') || phone.replace(/\D/g, '');
  const hasPantry = pantry.length > 0;
  const addressOk = address.line1.trim().length >= 6 && address.pincode.length === 6;
  const addressLine = [address.line1.trim(), address.landmark.trim(), address.city.trim(), address.pincode]
    .filter(Boolean)
    .join(', ');
  const nameOk = (name || user?.username || '').trim().length >= 2;
  const canPlace = nameOk && contactPhone.length >= 8 && addressOk;
  const onlineEnabled = Boolean(settings?.razorpayKeyId);
  const method = payment === 'razorpay' && !onlineEnabled ? 'cod' : payment;

  const blocker = !nameOk
    ? 'Add the name for this order.'
    : contactPhone.length < 8
      ? 'Add a mobile number so the rider can reach you.'
      : 'Add a delivery address with a 6-digit pincode.';

  /** Loads Razorpay's hosted Checkout.js once, on demand. */
  const loadRazorpay = () =>
    new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve(window.Razorpay);
      const el = document.createElement('script');
      el.src = 'https://checkout.razorpay.com/v1/checkout.js';
      el.onload = () => resolve(window.Razorpay);
      el.onerror = () => reject(new Error('Could not reach Razorpay. Try cash on delivery.'));
      document.body.appendChild(el);
      return undefined;
    });

  /** Opens the gateway and resolves with the fields /checkout/complete verifies. */
  const payWithRazorpay = (prepared) =>
    new Promise((resolve, reject) => {
      loadRazorpay()
        .then((Razorpay) => {
          const rz = new Razorpay({
            key: prepared.razorpayKeyId,
            order_id: prepared.razorpayOrderId,
            amount: Math.round(prepared.amount * 100),
            currency: 'INR',
            name: settings?.eventName || 'SpoonUp',
            description: `${count} ${count === 1 ? 'item' : 'items'}`,
            prefill: { name: (name || user?.username || '').trim(), contact: contactPhone },
            theme: { color: '#4A5D2E' },
            handler: (r) =>
              resolve({
                razorpayPaymentId: r.razorpay_payment_id,
                razorpayOrderId: r.razorpay_order_id,
                razorpaySignature: r.razorpay_signature
              }),
            modal: { ondismiss: () => reject(new Error('Payment cancelled.')) }
          });
          rz.on('payment.failed', (e) =>
            reject(new Error(e?.error?.description || 'Payment failed. Please try again.'))
          );
          rz.open();
        })
        .catch(reject);
    });

  /**
   * Places a real order for the kitchen and pantry lines through
   * /api/checkout/prepare + /complete. Plans are excluded because the backend has
   * no subscription model yet — they stay client-side until it does.
   */
  const placeOrder = async () => {
    setPlacing(true);
    setError('');
    setOfferCod(false);

    const sellableItems = [...kitchen, ...pantry].map((row) => ({ id: row.id, quantity: row.qty }));
    const slotLabel = kitchenMode === 'asap' ? 'ASAP · ~40 min' : kitchenSlot;

    const snapshot = {
      total,
      method,
      kitchen,
      pantry,
      plans,
      slot: slotLabel
    };

    try {
      if (sellableItems.length > 0) {
        const notes = [
          kitchen.length ? `Kitchen: ${slotLabel}` : '',
          kitchen.length ? `Deliver to: ${addressLine}` : '',
          plans.length ? `Plan (not yet supported server-side): ${plans.length}` : '',
          ''
        ]
          .filter(Boolean)
          .join(' · ');

        const prepared = await api.prepareCheckout({
          customerName: (name || user?.username || 'Guest').trim(),
          customerPhone: `+91${contactPhone}`,
          items: sellableItems,
          notes: notes.slice(0, 250),
          paymentMethod: method === 'cod' ? 'counter' : 'online',
          ...(hasPantry
            ? {
                deliveryAddress: {
                  line1: address.line1.trim(),
                  landmark: address.landmark.trim(),
                  city: address.city.trim(),
                  pincode: address.pincode
                }
              }
            : {})
        });

        const proof = method === 'cod' ? {} : await payWithRazorpay(prepared);
        const completed = await api.completeCheckout({ checkoutId: prepared.checkoutId, ...proof });
        const orders = completed.orders || [completed.order].filter(Boolean);
        rememberOrders(orders);
        snapshot.orders = orders;
        snapshot.id = orders[0] ? `SU-${orders[0].orderNumber}` : 'SU-0000';
        snapshot.serverTotal = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
      } else {
        // Plan-only cart: nothing the backend can accept yet.
        snapshot.id = 'SU-PLAN';
      }

      navigate('/order-confirmed', { state: snapshot, replace: true });
      clear();
    } catch (err) {
      setError(err.message || 'Could not place the order. Please try again.');
      setOfferCod(method !== 'cod');
      setPlacing(false);
    }
  };

  const parts = [
    kitchen.length && {
      type: 'kitchen',
      header: kitchenMode === 'asap' ? 'Kitchen · ASAP ~40 min' : `Kitchen · ${kitchenSlot}`,
      rows: kitchen.map((r) => `${r.qty}× ${r.name}`),
      amount: kitchenTotal
    },
    plans.length && {
      type: 'plan',
      header: `Plan · first delivery ${plans[0].startDate}`,
      rows: plans.map((p) => `${getProduct(p.productId)?.name} · ${p.deliveries} deliveries`),
      amount: plansTotal
    },
    pantry.length && {
      type: 'pantry',
      header: 'Pantry · ships in 3–5 days',
      rows: pantry.map((r) => `${r.qty}× ${r.name}${r.size ? ` (${r.size})` : ''}`),
      amount: pantryTotal
    }
  ].filter(Boolean);

  return (
    <Container className="pt-[34px] pb-[44px] grid gap-8 lg:gap-10 lg:grid-cols-[1.35fr_1fr] items-start">
      <div className="space-y-8 max-w-[640px]">
        <div>
          <h1 className="font-display text-[clamp(30px,3.6vw,40px)] text-ink m-0">Checkout</h1>
          <p className="text-[13.5px] text-ink-60 mt-2 mb-0">
            {count} {count === 1 ? 'item' : 'items'} in {parts.length}{' '}
            {parts.length === 1 ? 'part' : 'parts'}
          </p>
        </div>

        <Step
          n={1}
          title="Your details"
          right={
            user ? null : (
              <Link
                to="/signin?next=/checkout"
                className="text-[13px] font-medium text-olive underline underline-offset-2 hover:text-ink whitespace-nowrap pressable"
              >
                Sign in
              </Link>
            )
          }
        >
          <div className="space-y-3">
            <Field
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name for the order"
            />

            {user ? (
              <p className="text-[12.5px] text-ink-55 m-0">
                Signed in as <strong className="font-medium text-ink">{user.username}</strong>
                {user.phone ? ` · we'll call ${user.phone} if the rider needs you.` : '.'}
              </p>
            ) : (
              <Field label="Mobile number" hint="For delivery updates only. We don't send a code yet.">
                <div className="flex">
                  <span className="inline-flex items-center px-3 bg-cream border border-r-0 border-line-14 rounded-l-md text-[13px] text-ink-65">
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className="flex-1 bg-white border border-line-14 rounded-r-md px-3.5 py-2.5 text-[13.5px] focus:outline-none focus:border-olive"
                  />
                </div>
              </Field>
            )}

            {!user && (
              <p className="text-[12px] leading-[1.55] text-ink-55 m-0 pt-1">
                <Link to="/signin?next=/checkout" className="text-olive underline underline-offset-2">
                  Sign in or create an account
                </Link>{' '}
                to save this order and skip these details next time — your cart is kept.
              </p>
            )}
          </div>
        </Step>

        <Step n={2} title="Delivery address">
          <div className="space-y-3">
            <Field
              label="Flat / house, street, area"
              value={address.line1}
              onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
              placeholder="e.g. 402, 5th Cross, Koramangala"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="City"
                value={address.city}
                onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                placeholder="City"
              />
              <Field label="Pincode">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={address.pincode}
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))
                  }
                  placeholder="560095"
                  className="w-full bg-white border border-line-14 rounded-md px-3.5 py-2.5 text-[13.5px] focus:outline-none focus:border-olive"
                />
              </Field>
            </div>
            <Field
              label="Landmark (optional)"
              value={address.landmark}
              onChange={(e) => setAddress((a) => ({ ...a, landmark: e.target.value }))}
              placeholder="Near the park gate"
            />
          </div>

          {pantry.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-medium text-ink m-0 mb-2">
                Where should the pantry shipment go?
              </p>
              <div className="flex flex-wrap gap-2">
                <Pill selected={pantrySameAddress} onClick={() => setPantrySameAddress(true)}>
                  Same address · courier 3–5 days
                </Pill>
                <Pill selected={!pantrySameAddress} onClick={() => setPantrySameAddress(false)}>
                  A different address
                </Pill>
              </div>
              {!pantrySameAddress && (
                <p className="text-[12px] text-almond mt-2 mb-0 animate-expand">
                  {/* TODO: Handle core functionality later — one address per checkout server-side. */}
                  Separate pantry addresses aren&apos;t supported yet; the address above will be used
                  for both parts.
                </p>
              )}
            </div>
          )}
        </Step>

        {kitchen.length > 0 && (
          <Step n={3} title="When should the kitchen order arrive?">
            <div className="flex gap-2 mb-3">
              <Pill selected={kitchenMode === 'asap'} onClick={() => setKitchenMode('asap')}>
                As soon as possible · ~40 min
              </Pill>
              <Pill selected={kitchenMode === 'schedule'} onClick={() => setKitchenMode('schedule')}>
                Schedule
              </Pill>
            </div>
            {kitchenMode === 'schedule' && (
              <div className="flex flex-wrap gap-2 animate-expand">
                {KITCHEN_SLOTS.map((s) => (
                  <Pill key={s} selected={kitchenSlot === s} accent="#4A5D2E" onClick={() => setKitchenSlot(s)}>
                    {s}
                  </Pill>
                ))}
              </div>
            )}
          </Step>
        )}

        <Step n={kitchen.length ? 4 : 3} title="Coupon">
          {/* TODO: Handle core functionality later — the server has no coupon model,
              so applying one here would not change what Razorpay charges. */}
          <div className="flex gap-2 opacity-60">
            <input
              disabled
              placeholder="Coupons aren't live yet"
              className="flex-1 bg-white border border-line-14 rounded-md px-3.5 py-2.5 text-[13.5px] cursor-not-allowed"
            />
            <button
              type="button"
              disabled
              className="bg-ink text-paper rounded-md px-4 py-2.5 text-[13px] font-medium cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </Step>

        <Step n={kitchen.length ? 5 : 4} title="Payment">
          <div className="space-y-2">
            {PAYMENT_METHODS.map((m) => {
              const unavailable = m.id === 'razorpay' && !onlineEnabled;
              const on = method === m.id;
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 bg-white border rounded-lg p-3.5 ${
                    unavailable ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer pressable'
                  }`}
                  style={{ borderColor: on ? '#4A5D2E' : 'rgba(27,42,24,.14)' }}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={on}
                    disabled={unavailable}
                    onChange={() => setPayment(m.id)}
                    className="accent-[#4A5D2E]"
                  />
                  <span className="flex-1">
                    <span className="block text-[13.5px] font-medium text-ink">{m.label}</span>
                    <span className="block text-[12px] text-ink-55">
                      {unavailable ? 'Unavailable — payment gateway keys not set' : m.note}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {method === 'cod' && (
            <p className="text-[12px] leading-[1.6] text-ink-55 mt-3 mb-0 animate-expand">
              Pay when the order reaches you. We&apos;ll mark it paid at handover.
            </p>
          )}
        </Step>
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-8 bg-cream rounded-card p-6">
        <h2 className="text-[15px] font-medium text-ink m-0 mb-4">
          Your order · {parts.length} {parts.length === 1 ? 'delivery' : 'deliveries'}
        </h2>

        <div className="space-y-3">
          {parts.map((part) => {
            const t = ORDER_TYPES[part.type];
            return (
              <div
                key={part.type}
                className="bg-white rounded-lg border border-line-10 p-3.5"
                style={{ borderLeft: `3px solid ${t.color}` }}
              >
                <p
                  className="font-mono text-[9.5px] uppercase tracking-[0.1em] m-0 mb-1.5"
                  style={{ color: t.color }}
                >
                  {part.header}
                </p>
                {part.rows.map((row) => (
                  <p key={row} className="text-[12.5px] text-ink-72 m-0">
                    {row}
                  </p>
                ))}
                <p className="text-[13px] font-medium text-ink m-0 mt-1.5">{rupees(part.amount)}</p>
              </div>
            );
          })}
        </div>

        <dl className="m-0 mt-5 pt-5 border-t border-line-12 space-y-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-ink-65">Items</dt>
            <dd className="m-0 tabular-nums">{rupees(subtotalAmount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-65">Delivery</dt>
            <dd className="m-0 tabular-nums">Free</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-65">GST</dt>
            <dd className="m-0 tabular-nums">{rupees(gst)}</dd>
          </div>
          <div className="flex justify-between items-baseline pt-3 border-t border-line-12">
            <dt className="text-[14px] font-medium text-ink">Total</dt>
            <dd key={total} className="m-0 font-display text-[28px] text-ink tabular-nums num-tick">
              {rupees(total)}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          disabled={!canPlace || placing}
          onClick={placeOrder}
          className="w-full mt-5 bg-olive text-paper rounded-pill py-3.5 text-[14px] font-medium hover:brightness-110 cursor-pointer pressable disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {placing ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-paper/30 border-t-paper rounded-full animate-spin" />
              Placing order…
            </span>
          ) : method === 'cod'
            ? `Place order · ${rupees(total)} on delivery`
            : `Pay ${rupees(total)} with Razorpay`}
        </button>
        {!canPlace && (
          <p className="text-[11.5px] text-almond text-center mt-2 mb-0">{blocker}</p>
        )}
        {error && (
          <div className="mt-3">
            <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 m-0">
              {error}
            </p>
            {offerCod && (
              <button
                type="button"
                onClick={() => {
                  setPayment('cod');
                  setError('');
                  setOfferCod(false);
                }}
                className="w-full mt-2 border border-line-20 text-ink rounded-pill py-2.5 text-[13px] font-medium cursor-pointer pressable hover:bg-tint-ink"
              >
                Pay cash on delivery instead
              </button>
            )}
          </div>
        )}
        {plans.length > 0 && (
          <p className="text-[11px] leading-[1.55] text-ink-50 mt-3 mb-0">
            {/* TODO: Handle core functionality later — subscriptions are not yet
                stored server-side, so the plan is recorded on this device only. */}
            Subscriptions are not yet handled by the server; the plan in this order is recorded
            locally for now.
          </p>
        )}

        <p className="text-[10.5px] leading-[1.6] text-ink-50 mt-3 mb-0">
          By paying you accept the Terms, Wallet &amp; Subscription terms and the Return policy.
        </p>
      </aside>
    </Container>
  );
}
