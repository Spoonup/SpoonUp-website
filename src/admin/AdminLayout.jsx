import React, { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import PageTransition from '../components/PageTransition';

/**
 * Admin chrome from screen 1d: 210px ink rail, mono "SPOONUP ADMIN" eyebrow,
 * 12% paper wash on the active item. The status card, user chip and customer-site
 * link at the foot are kept from the previous build at the user's request.
 */
const NAV = [
  { to: '/admin/orders', label: 'Orders', key: 'orders' },
  { to: '/admin/subscriptions', label: 'Subscriptions' },
  { to: '/admin/deliveries', label: 'Pantry shipments', key: 'dispatch' },
  { to: '/admin/products', label: 'Products & menu', key: 'products' },
  { to: '/admin/customers', label: 'Customers' },
  { to: '/admin/payments', label: 'Payments & wallets' },
  { to: '/admin/coupons', label: 'Coupons' },
  { to: '/admin/take-order', label: 'Take an order' },
  { to: '/admin/pricing', label: 'Pricing by channel' },
  { to: '/admin/referrals', label: 'Referrals' },
  { to: '/admin/settings', label: 'Settings' }
];

export default function AdminLayout({ onLogout, counts = {}, settings = {} }) {
  const [open, setOpen] = useState(false);

  const item = ({ isActive }) =>
    `flex items-center justify-between gap-3 rounded-btn px-3 py-2.5 text-[13px] transition pressable ${
      isActive
        ? 'bg-paper/12 text-paper font-medium'
        : 'text-paper/70 font-normal hover:bg-paper/8 hover:text-paper'
    }`;

  return (
    <div className="min-h-screen bg-[#F7F6F1] lg:grid lg:grid-cols-[210px_1fr]">
      <aside className="bg-ink lg:sticky lg:top-0 lg:h-screen flex flex-col px-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/admin/orders"
            className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-sage px-2.5 pt-1.5 pb-3.5"
          >
            SpoonUp Admin
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden w-9 h-9 grid place-items-center rounded-btn text-paper/70 text-[15px] cursor-pointer pressable"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? '✕' : '☰'}
          </button>
        </div>

        <div className={`${open ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-h-0`}>
          <nav className="flex flex-col gap-1.5 overflow-y-auto">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className={item}>
                <span>{n.label}</span>
                {n.key && counts[n.key] > 0 && (
                  <span className="font-mono text-[10.5px] opacity-70 tabular-nums">{counts[n.key]}</span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* kept from the previous build */}
          <div className="mt-auto flex flex-col gap-3 pt-5">
            <div className="flex flex-col gap-1 p-3 rounded-lg bg-paper/8">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-paper m-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: counts.orders > 0 ? 'var(--color-sage)' : 'rgba(252,251,247,.35)' }}
                />
                {counts.orders > 0 ? 'Kitchen busy' : 'Kitchen clear'}
              </p>
              <p className="text-[11.5px] leading-[1.4] text-paper/60 m-0">
                {counts.orders > 0
                  ? `${counts.orders} live ${counts.orders === 1 ? 'ticket' : 'tickets'}`
                  : 'No live tickets'}
              </p>
            </div>

            <div className="flex items-center gap-2.5 px-1">
              <span className="w-8 h-8 rounded-full bg-olive text-paper grid place-items-center text-[12px] font-semibold shrink-0">
                {(settings.adminUsername || 'SU').slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[12.5px] font-semibold text-paper truncate">
                  {settings.adminUsername || 'Staff'}
                </span>
                <span className="text-[11px] text-paper/55 truncate">
                  {settings.counterName || 'Counter'}
                </span>
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="text-[11.5px] font-medium text-paper/55 hover:text-paper cursor-pointer pressable shrink-0"
              >
                Sign out
              </button>
            </div>

            <Link
              to="/"
              className="rounded-btn border border-paper/20 px-3 py-2 text-[11.5px] text-paper/60 hover:text-paper hover:border-paper/40 transition"
            >
              Customer site ↗
            </Link>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-5 lg:px-7 py-6">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>
    </div>
  );
}
