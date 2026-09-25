import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rupees } from '../data/catalogue';
import { ORDER_TYPES } from '../lib/orderTypes';
import { adminFetch } from '../lib/adminSession';

/**
 * Screen 1d — "Orders, split by part", wired to the live order poll.
 *
 * The design's "3 PARTS" maps onto the real data model: a cart containing
 * deliver-later items is split by the server into one immediate and one delivery
 * order sharing a `paymentGroupId`. Grouping on that key reproduces the design's
 * parent row + part cards exactly, with no invented structure.
 */

const COLS = 'grid-cols-[130px_minmax(0,1fr)_120px_minmax(0,1fr)_120px_110px]';

// Only the parts the server actually models are selectable.
const FILTERS = [
  { id: 'all', label: 'All parts', accent: null },
  { id: 'kitchen', label: 'Eat now', accent: '#4A5D2E' },
  { id: 'scheduled', label: 'Scheduled', accent: null, unsupported: 'No scheduling model yet' },
  { id: 'subscription', label: 'Subscription delivery', accent: null, unsupported: 'No subscription model yet' },
  { id: 'pantry', label: 'Pantry', accent: '#8B6A46' }
];

const NEXT = {
  kitchen: { pending: 'preparing', preparing: 'ready', ready: 'completed' },
  pantry: { pending: 'shipped', shipped: 'delivered' }
};
const NEXT_LABEL = {
  preparing: 'Start prep',
  ready: 'Mark ready',
  completed: 'Hand over',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered'
};

const partOf = (o) => (o.fulfillmentType === 'delivery' ? 'pantry' : 'kitchen');
const itemsLine = (o) =>
  (o.items || []).map((i) => `${i.name} × ${i.quantity}`).join(', ') || `Order #${o.orderNumber}`;

function statusLine(o) {
  const t = new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (o.status === 'pending') return `Placed ${t}`;
  return `${o.status.charAt(0).toUpperCase()}${o.status.slice(1)} · ${t}`;
}

export default function AdminOrdersPage({ orders = [], updateStatus, adminToken, connectionError }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Split baskets open by default, as in the design; single rows open on click.
  const [openRow, setOpenRow] = useState(null);

  // how many orders each phone has ever placed — the design's "· 14 orders"
  const historyByPhone = useMemo(() => {
    const m = {};
    orders.forEach((o) => {
      const k = o.customerPhone || '';
      if (k) m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [orders]);

  // group the server's split orders back into one row per basket
  const groups = useMemo(() => {
    const byKey = new Map();
    [...orders]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((o) => {
        const key = o.paymentGroupId || o.id;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(o);
      });
    return [...byKey.entries()].map(([key, parts]) => {
      const head = parts[0];
      return {
        key,
        head,
        parts,
        total: parts.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0),
        types: new Set(parts.map(partOf))
      };
    });
  }, [orders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => {
        if (filter === 'all') return true;
        if (filter === 'kitchen' || filter === 'pantry') return g.types.has(filter);
        return false;
      })
      .filter((g) =>
        !q
          ? true
          : [g.head.orderNumber, g.head.customerName, g.head.customerPhone]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
      );
  }, [groups, filter, query]);

  const kpis = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => new Date(o.createdAt) >= start);
    return [
      {
        label: 'Live kitchen orders',
        value: orders.filter((o) => partOf(o) === 'kitchen' && ['pending', 'preparing', 'ready'].includes(o.status)).length
      },
      { label: 'Orders today', value: today.length },
      {
        label: 'Pantry to dispatch',
        value: orders.filter((o) => partOf(o) === 'pantry' && o.status === 'pending').length
      },
      {
        label: 'Revenue today',
        value: rupees(
          Math.round(
            today
              .filter((o) => o.paymentStatus === 'paid' && !['cancelled', 'rejected'].includes(o.status))
              .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
          )
        )
      }
    ];
  }, [orders]);

  const advance = async (order) => {
    const to = NEXT[partOf(order)]?.[order.status];
    if (!to) return;
    setBusy(order.id);
    setRowError(null);
    try {
      await updateStatus(order.id, to);
    } catch (err) {
      setRowError({ id: order.id, message: err.message });
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await adminFetch('/api/orders/export/csv', adminToken);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spoonup-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setRowError({ id: 'export', message: err.message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-[18px]">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[26px] leading-none text-ink m-0">Orders</h1>
        <div className="flex gap-2.5 text-[12.5px] font-medium">
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            className="text-ink border border-line-20 rounded-btn px-3.5 py-2.5 cursor-pointer pressable hover:bg-tint-ink disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/admin/take-order')}
            className="text-paper bg-olive rounded-btn px-4 py-2.5 cursor-pointer pressable hover:brightness-110"
          >
            Take an order
          </button>
        </div>
      </div>

      {connectionError && (
        <p className="text-[12.5px] text-almond bg-tint-almond rounded-md px-3.5 py-2.5 m-0">{connectionError}</p>
      )}
      {rowError?.id === 'export' && (
        <p className="text-[12.5px] text-almond m-0">{rowError.message}</p>
      )}

      {/* ---- KPIs ---- */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-line-10 rounded-[9px] px-4 py-3.5">
            <p className="text-[11px] text-ink-55 m-0">{k.label}</p>
            <p className="font-display text-[28px] leading-tight text-ink m-0 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      {/* ---- filters ---- */}
      <div className="flex gap-2.5 flex-wrap items-center text-[12px] font-medium">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              disabled={Boolean(f.unsupported)}
              title={f.unsupported || undefined}
              onClick={() => setFilter(f.id)}
              className={`px-3.5 py-2 rounded-pill whitespace-nowrap transition ${
                f.unsupported ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer pressable'
              } ${on ? 'bg-ink text-paper' : 'bg-transparent'}`}
              style={
                on
                  ? undefined
                  : {
                      color: f.accent || 'var(--color-ink)',
                      border: `1px solid ${f.accent ? `${f.accent}59` : 'rgba(27,42,24,.18)'}`
                    }
              }
            >
              {f.label}
            </button>
          );
        })}
        <label className="ml-auto">
          <span className="sr-only">Search orders</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order ID, phone, name"
            className="w-[240px] max-w-full bg-transparent border border-line-14 rounded-pill px-3.5 py-2 text-[12px] text-ink placeholder:text-ink-55 focus:outline-none focus:border-olive transition"
          />
        </label>
      </div>

      {/* ---- table ---- */}
      <div className="bg-white border border-line-10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className={`grid ${COLS} gap-3 px-4 py-3 bg-cream font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-60`}>
              <span>Order</span><span>Customer</span><span>Part</span>
              <span>Status</span><span>Value</span><span>Payment</span>
            </div>

            {visible.map((g) => {
              const multi = g.parts.length > 1;
              const headType = ORDER_TYPES[partOf(g.head)];
                const expanded = multi || openRow === g.key;
                return (
                <div
                  key={g.key}
                  className="border-b border-line-07 last:border-b-0 px-4 py-3.5"
                  style={multi ? { background: 'rgba(74,93,46,.03)' } : undefined}
                >
                  <div
                    role={multi ? undefined : 'button'}
                    tabIndex={multi ? undefined : 0}
                    onClick={multi ? undefined : () => setOpenRow(expanded ? null : g.key)}
                    onKeyDown={
                      multi
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setOpenRow(expanded ? null : g.key);
                            }
                          }
                    }
                    aria-expanded={multi ? undefined : expanded}
                    className={`grid ${COLS} gap-3 items-center text-[12.5px] text-ink ${
                      multi ? '' : 'cursor-pointer'
                    }`}
                  >
                    <span className="font-mono text-[11.5px]">#{g.head.orderNumber}</span>

                    <span className="min-w-0">
                      <span className="block truncate">{g.head.customerName || 'Guest'}</span>
                      <span className="block text-[11px] text-ink-50 truncate">
                        {g.head.customerPhone || '—'}
                        {historyByPhone[g.head.customerPhone] > 1 &&
                          ` · ${historyByPhone[g.head.customerPhone]} orders`}
                      </span>
                    </span>

                    <span
                      className="font-mono text-[10px] font-medium uppercase"
                      style={{ color: multi ? 'var(--color-olive)' : headType.color }}
                    >
                      {multi ? `${g.parts.length} parts` : headType.label}
                    </span>

                    <span className="text-ink-50 truncate">
                      {multi ? 'mixed — see below' : statusLine(g.head)}
                    </span>

                    <span className="font-medium tabular-nums">{rupees(Math.round(g.total))}</span>

                    <span className="text-[11.5px] text-ink-60 capitalize">
                      {g.head.paymentMethod === 'online' ? 'Online' : 'Counter'}
                      {g.head.paymentStatus !== 'paid' && (
                        <span className="block text-[10.5px] text-almond">unpaid</span>
                      )}
                    </span>
                  </div>

                  {/* the design shows part cards for the split basket only */}
                  {expanded && (
                  <div className="mt-[11px] flex flex-col gap-[7px] pl-3 animate-expand">
                      {g.parts.map((o) => {
                        const t = ORDER_TYPES[partOf(o)];
                        const to = NEXT[partOf(o)]?.[o.status];
                        return (
                          <div
                            key={o.id}
                            className="grid gap-3 items-center rounded-btn px-3 py-2.5 text-[12px] text-ink bg-paper lg:grid-cols-[minmax(0,1fr)_200px_120px_auto]"
                            style={{ border: `1px solid ${t.color}40`, borderLeft: `3px solid ${t.color}` }}
                          >
                            <span className="min-w-0 truncate">
                              <span
                                className="font-mono text-[9.5px] font-medium uppercase mr-1"
                                style={{ color: t.color }}
                              >
                                {t.label}
                              </span>
                              · {itemsLine(o)}
                            </span>

                            <span className="text-ink-60 truncate">{statusLine(o)}</span>

                            <span className="font-medium tabular-nums">
                              {rupees(Math.round(Number(o.totalAmount) || 0))}
                            </span>

                            <span className="flex gap-[7px] text-[11px] font-medium">
                              {to ? (
                                <button
                                  type="button"
                                  disabled={busy === o.id}
                                  onClick={() => advance(o)}
                                  className="rounded-sm px-2.5 py-1.5 text-paper cursor-pointer pressable hover:brightness-110 disabled:opacity-50 whitespace-nowrap"
                                  style={{ background: t.color }}
                                >
                                  {busy === o.id ? 'Saving…' : NEXT_LABEL[to]}
                                </button>
                              ) : (
                                <span className="text-ink-45 px-1 py-1.5 whitespace-nowrap">Done</span>
                              )}
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/orders?q=${o.orderNumber}`)}
                                className="rounded-sm border border-line-18 px-2.5 py-1.5 text-ink cursor-pointer pressable hover:bg-tint-ink whitespace-nowrap"
                              >
                                Details
                              </button>
                            </span>

                            {rowError?.id === o.id && (
                              <span className="col-span-full text-[11px] text-almond">{rowError.message}</span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  )}
                </div>
              );
            })}

            {visible.length === 0 && (
              <p className="p-10 text-center text-[13.5px] text-ink-55 m-0">
                {query ? `No orders match “${query}”.` : 'No orders in this view yet.'}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11.5px] text-ink-50 m-0">
        Showing {visible.length} of {groups.length} · live, refreshes every 4s
      </p>
    </div>
  );
}
