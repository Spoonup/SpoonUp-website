import React, { useMemo, useState } from 'react';
import { rupees } from '../data/catalogue';

/**
 * Customers, derived from the live order history. There is no customer table on
 * the server (guests order without an account), so a "customer" here is every
 * order that shares a phone number — which is how the counter thinks about it.
 */
export default function AdminCustomers({ orders = [] }) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const byPhone = new Map();
    orders.forEach((o) => {
      const key = String(o.customerPhone || '').replace(/\D/g, '') || `anon-${o.id}`;
      if (!byPhone.has(key)) {
        byPhone.set(key, { key, phone: o.customerPhone || '—', name: o.customerName || 'Guest', orders: [], spend: 0 });
      }
      const row = byPhone.get(key);
      row.orders.push(o);
      if (o.paymentStatus === 'paid' && !['cancelled', 'rejected'].includes(o.status)) {
        row.spend += Number(o.totalAmount) || 0;
      }
      if (new Date(o.createdAt) > new Date(row.orders[0].createdAt)) row.name = o.customerName || row.name;
    });
    return [...byPhone.values()]
      .map((r) => ({
        ...r,
        count: r.orders.length,
        last: r.orders.map((o) => new Date(o.createdAt)).sort((a, b) => b - a)[0],
        registered: r.orders.some((o) => o.userId)
      }))
      .sort((a, b) => b.last - a.last);
  }, [orders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.name} ${r.phone}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const COLS = 'grid-cols-[minmax(0,1fr)_150px_90px_120px_130px]';

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] leading-none text-ink m-0">Customers</h1>
          <p className="text-[12.5px] text-ink-60 mt-2 mb-0">
            Grouped by phone number from the live order history.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone"
          aria-label="Search customers"
          className="w-[240px] max-w-full bg-transparent border border-line-14 rounded-pill px-3.5 py-2 text-[12px] focus:outline-none focus:border-olive"
        />
      </div>

      <div className="bg-white border border-line-10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className={`grid ${COLS} gap-3 px-4 py-3 bg-cream font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-60`}>
              <span>Customer</span><span>Phone</span><span>Orders</span><span>Paid</span><span>Last order</span>
            </div>
            {visible.map((r) => (
              <div key={r.key} className={`grid ${COLS} gap-3 items-center px-4 py-3 border-t border-line-07 text-[12.5px] text-ink`}>
                <span className="min-w-0 truncate">
                  {r.name}
                  {r.registered && (
                    <span className="ml-2 font-mono text-[9.5px] uppercase text-olive bg-tint-olive rounded-tag px-1.5 py-0.5">
                      account
                    </span>
                  )}
                </span>
                <span className="text-ink-60 truncate">{r.phone}</span>
                <span className="tabular-nums">{r.count}</span>
                <span className="tabular-nums font-medium">{rupees(Math.round(r.spend))}</span>
                <span className="text-ink-60">
                  {r.last.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
            {visible.length === 0 && (
              <p className="p-10 text-center text-[13.5px] text-ink-55 m-0">
                {query ? `No customer matches “${query}”.` : 'No orders yet.'}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11.5px] text-ink-50 m-0">
        {visible.length} of {rows.length} · derived from {orders.length} orders
      </p>
    </div>
  );
}
