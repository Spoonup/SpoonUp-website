import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Field from '../components/ui/Field';
import { rupees } from '../data/catalogue';
import { adminFetch } from '../lib/adminSession';

/**
 * 1e · Take an order on behalf of a customer — walk-ins, events, phone orders.
 *
 * Every product here is the live catalogue and the order is created through
 * POST /api/orders, so it lands in the same queue as a customer's own order.
 * The server re-prices every line, so the "agreed price" cannot change what is
 * charged; it is recorded in the order notes for the counter to settle against.
 */

const COLLECTION = ['Cash', 'UPI QR', 'Card machine'];

export default function AdminTakeOrder({ products = [], orders = [], adminToken, onPlaced }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lines, setLines] = useState([]);
  const [agreed, setAgreed] = useState('');
  const [collect, setCollect] = useState('Cash');
  const [search, setSearch] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  const available = useMemo(
    () => products.filter((p) => p.isAvailable !== false),
    [products]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? available.filter((p) => p.name.toLowerCase().includes(q)) : available;
  }, [available, search]);

  const listTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const agreedNum = Number(agreed) || 0;
  const discount = agreed === '' ? 0 : Math.max(0, listTotal - agreedNum);
  const needsAddress = lines.some((l) => l.deliverLater);

  const add = (p) =>
    setLines((prev) => {
      const found = prev.find((l) => l.id === p.id);
      if (found) return prev.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: p.id, name: p.name, price: p.price, deliverLater: p.deliverLater, qty: 1 }];
    });

  const setQty = (id, qty) =>
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.id !== id) : prev.map((l) => (l.id === id ? { ...l, qty } : l))));

  /** Real lookup: match this phone against the orders already in the system. */
  const doLookup = () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) {
      setLookup({ found: false, message: 'Enter at least 8 digits.' });
      return;
    }
    const past = orders.filter((o) => String(o.customerPhone || '').replace(/\D/g, '').endsWith(digits.slice(-8)));
    if (past.length === 0) {
      setLookup({ found: false, message: 'No previous orders on this number — a new record is created.' });
      return;
    }
    const latest = past.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (!name) setName(latest.customerName || '');
    setLookup({
      found: true,
      message: `${latest.customerName || 'Customer'} · ${past.length} previous ${past.length === 1 ? 'order' : 'orders'}`
    });
  };

  const place = async () => {
    setPlacing(true);
    setError('');
    const notes = [
      'Taken at counter by admin',
      `Collected via ${collect}`,
      discount > 0 ? `Agreed ${rupees(agreedNum)} vs list ${rupees(listTotal)} (−${rupees(discount)})` : ''
    ]
      .filter(Boolean)
      .join(' · ');

    try {
      const res = await adminFetch('/api/orders', adminToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          items: lines.map((l) => ({ id: l.id, quantity: l.qty })),
          notes: notes.slice(0, 250)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the order.');
      onPlaced?.();
      navigate('/admin/orders');
    } catch (err) {
      setError(err.message);
      setPlacing(false);
    }
  };

  const nameOk = name.trim().length >= 2;
  const phoneOk = phone.replace(/\D/g, '').length >= 8;
  const canPlace = nameOk && phoneOk && lines.length > 0 && !needsAddress;

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="font-display text-[26px] leading-none text-ink m-0">Take an order</h1>
        <p className="text-[12.5px] text-ink-60 mt-2 mb-0">
          For walk-ins, events and phone orders. Created as a counter order in the live queue.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] items-start">
        <div className="flex flex-col gap-4">
          <section className="bg-white rounded-lg border border-line-10 p-5">
            <h2 className="text-[14.5px] font-semibold text-ink m-0 mb-3">Customer</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name for the order" />
              <Field label="Phone number">
                <div className="flex gap-2">
                  <input
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setLookup(null);
                    }}
                    inputMode="numeric"
                    placeholder="10-digit mobile number"
                    className="flex-1 min-w-0 bg-white border border-line-14 rounded-md px-3.5 py-2.5 text-[13.5px] focus:outline-none focus:border-olive"
                  />
                  <button
                    type="button"
                    onClick={doLookup}
                    className="bg-ink text-paper rounded-md px-3.5 py-2.5 text-[12.5px] font-medium cursor-pointer pressable hover:brightness-125 whitespace-nowrap"
                  >
                    Look up
                  </button>
                </div>
              </Field>
            </div>
            <p
              className="text-[11.5px] m-0 mt-2"
              style={{ color: lookup?.found ? 'var(--color-olive)' : 'var(--color-ink-50)' }}
            >
              {lookup?.message || 'Look up matches this number against existing orders.'}
            </p>
          </section>

          <section className="bg-white rounded-lg border border-line-10 p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-[14.5px] font-semibold text-ink m-0">Items</h2>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter menu"
                className="w-[180px] bg-transparent border border-line-14 rounded-pill px-3.5 py-1.5 text-[12px] focus:outline-none focus:border-olive"
              />
            </div>

            {available.length === 0 ? (
              <p className="text-[13px] text-ink-55 m-0">Loading the live menu…</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4 max-h-[168px] overflow-y-auto">
                {shown.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p)}
                    className="rounded-pill border border-line-16 px-3 py-1.5 text-[12px] text-ink cursor-pointer pressable hover:bg-tint-ink whitespace-nowrap"
                  >
                    + {p.name} · {rupees(p.price)}
                  </button>
                ))}
                {shown.length === 0 && <p className="text-[12.5px] text-ink-55 m-0">Nothing matches that.</p>}
              </div>
            )}

            {lines.length === 0 ? (
              <p className="text-[13px] text-ink-50 m-0">No items yet.</p>
            ) : (
              <ul className="list-none p-0 m-0">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2 border-b border-line-08 last:border-0">
                    <span className="text-[13px] text-ink min-w-0 truncate">{l.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => setQty(l.id, l.qty - 1)} aria-label={`Fewer ${l.name}`}
                        className="w-6 h-6 grid place-items-center rounded-sm border border-line-16 cursor-pointer pressable">−</button>
                      <span className="text-[13px] tabular-nums w-5 text-center">{l.qty}</span>
                      <button type="button" onClick={() => setQty(l.id, l.qty + 1)} aria-label={`More ${l.name}`}
                        className="w-6 h-6 grid place-items-center rounded-sm border border-line-16 cursor-pointer pressable">+</button>
                      <span className="text-[13px] tabular-nums text-ink w-16 text-right">{rupees(l.price * l.qty)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {needsAddress && (
              <p className="text-[12px] text-almond m-0 mt-3">
                {/* TODO: Handle core functionality later — counter orders have no address form yet. */}
                This basket has a deliver-later item, which needs a shipping address. Remove it, or
                place that part from the customer site.
              </p>
            )}
          </section>
        </div>

        <aside className="bg-ink text-paper rounded-lg p-6 lg:sticky lg:top-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-sage m-0">Settlement</p>

          <div className="flex justify-between mt-4 text-[13.5px]">
            <span className="text-paper/70">List total</span>
            <span className="tabular-nums">{rupees(listTotal)}</span>
          </div>
          <p className="text-[11px] text-paper/50 m-0 mt-1">Excludes GST — the server adds it.</p>

          <div className="mt-4">
            <label htmlFor="agreed" className="block text-[12.5px] text-paper/70 mb-1.5">
              Amount the customer agreed to pay
            </label>
            <input
              id="agreed"
              type="number"
              value={agreed}
              onChange={(e) => setAgreed(e.target.value)}
              placeholder={String(listTotal)}
              className="w-full bg-paper/10 border border-paper/20 rounded-md px-3.5 py-2.5 text-[14px] text-paper placeholder:text-paper/40 focus:outline-none focus:border-sage"
            />
          </div>

          {discount > 0 && (
            <div className="flex justify-between mt-3 text-[13px] text-sage">
              <span>Recorded as negotiated</span>
              <span className="tabular-nums">
                {rupees(discount)} · {((discount / listTotal) * 100).toFixed(1)}%
              </span>
            </div>
          )}
          <p className="text-[11px] leading-[1.55] text-paper/55 mt-2 mb-0">
            Prices are set by the server, so this does not change the amount charged — it is written
            to the order notes for the counter to settle against.
          </p>

          <div className="mt-5">
            <p className="text-[12.5px] text-paper/70 m-0 mb-2">Collected via</p>
            <div className="flex flex-wrap gap-2">
              {COLLECTION.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCollect(c)}
                  className={`rounded-pill px-3.5 py-2 text-[12px] font-medium cursor-pointer pressable ${
                    collect === c ? 'bg-sage text-ink' : 'bg-paper/10 text-paper/75 hover:bg-paper/15'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!canPlace || placing}
            onClick={place}
            className="w-full mt-6 bg-olive text-paper rounded-pill py-3 text-[14px] font-medium hover:brightness-110 cursor-pointer pressable disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {placing ? 'Creating…' : `Create order · ${rupees(listTotal)} + GST`}
          </button>

          {!canPlace && !placing && (
            <p className="text-[11.5px] text-sage/80 text-center mt-2 mb-0">
              {lines.length === 0
                ? 'Add at least one item.'
                : !nameOk
                  ? 'Add the customer’s name.'
                  : !phoneOk
                    ? 'Add a phone number.'
                    : 'Remove the deliver-later item to continue.'}
            </p>
          )}
          {error && <p className="text-[11.5px] text-center mt-2 mb-0" style={{ color: '#E08A5F' }}>{error}</p>}
        </aside>
      </div>
    </div>
  );
}
