import React from 'react';
import { NavLink, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import Container from '../components/layout/Container';
import ProgressSteps from '../components/ui/ProgressSteps';
import Button from '../components/ui/Button';
import { ORDER_TYPES } from '../lib/orderTypes';
import { rupees } from '../data/catalogue';
import { useAccount } from '../lib/useAccount';
import { useUser } from '../lib/useUser';

const NAV = [
  { to: '', label: 'Overview', end: true },
  { to: 'orders', label: 'Orders' },
  { to: 'plans', label: 'My plans' },
  { to: 'wallet', label: 'Wallet' },
  { to: 'addresses', label: 'Addresses' },
  { to: 'referrals', label: 'Refer & earn' },
  { to: 'profile', label: 'Profile & settings' }
];

const Card = ({ className = '', children }) => (
  <div className={`bg-white rounded-card border border-line-10 p-5 ${className}`}>{children}</div>
);

/** Wallet, plans, referrals and the address book have no server model yet. */
const NotYet = ({ title, blurb, cta }) => (
  <div className="bg-white rounded-card border border-dashed border-line-20 p-8 text-center">
    <p className="text-[14px] font-medium text-ink m-0">{title}</p>
    <p className="text-[13px] leading-[1.6] text-ink-55 mt-2 mb-0 max-w-[420px] mx-auto">{blurb}</p>
    {cta}
  </div>
);

const SectionTitle = ({ children, right }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
    <h2 className="text-[16px] font-medium text-ink m-0">{children}</h2>
    {right}
  </div>
);

function WalletCard() {
  const { wallet } = useAccount();
  if (!wallet.supported) {
    return (
      <div className="bg-ink text-paper rounded-card p-5 flex flex-col">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-sage m-0">Wallet</p>
        <p className="text-[13.5px] leading-[1.6] text-paper/70 mt-3 mb-0">
          Your SpoonUp wallet isn&apos;t live yet. Once plans are running you&apos;ll see your plan
          balance and spendable credit here.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-ink text-paper rounded-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-sage m-0">Wallet</p>
      <p className="font-display text-[32px] leading-none mt-3 mb-0">{rupees(wallet.total)}</p>
      <div className="flex gap-5 mt-4 text-[12px]">
        <span className="text-paper/70">
          Plan balance <strong className="block text-paper font-medium text-[13px]">{rupees(wallet.planBalance)}</strong>
        </span>
        <span className="text-paper/70">
          Spendable <strong className="block text-paper font-medium text-[13px]">{rupees(wallet.spendable)}</strong>
        </span>
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="sage" size="sm">Top up</Button>
        <Button to="/account/wallet" variant="outlineOnDark" size="sm">Activity</Button>
      </div>
    </div>
  );
}

function greetingFor(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Overview() {
  const { displayName, memberSince, orderCount, liveOrders, pastOrders, loading, plans, referral } =
    useAccount();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-[clamp(28px,3.4vw,38px)] text-ink m-0">
          {greetingFor()}, {displayName}
        </h1>
        <p className="text-[13.5px] text-ink-60 mt-2 mb-0">
          {liveOrders.length === 0
            ? 'Nothing on its way right now.'
            : `${liveOrders.length} order${liveOrders.length === 1 ? '' : 's'} on its way.`}
        </p>
        <p className="text-[12px] text-ink-50 mt-1 mb-0">
          {memberSince ? `Member since ${memberSince} · ` : ''}
          {orderCount} {orderCount === 1 ? 'order' : 'orders'}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3 stagger">
        <WalletCard />
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-almond m-0">Active plans</p>
          {plans.supported ? (
            <p className="font-display text-[32px] leading-none text-ink mt-3 mb-0">{plans.items.length}</p>
          ) : (
            <p className="text-[13px] leading-[1.6] text-ink-55 mt-3 mb-0">
              Subscriptions aren&apos;t live yet. Build a plan and we&apos;ll show it here as soon as
              they are.
            </p>
          )}
          <Button to="/subscribe" variant="text" className="mt-3 !text-[12.5px]">Plan builder →</Button>
        </Card>
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-almond m-0">Refer &amp; earn</p>
          {referral.supported ? (
            <>
              <p className="text-[13.5px] font-medium text-ink mt-3 mb-0">Give ₹150, get ₹150</p>
              <p className="font-mono text-[16px] text-ink mt-2 mb-0 tracking-[0.1em]">{referral.code}</p>
              <p className="text-[12px] text-ink-55 mt-2.5 mb-0">
                {referral.joined} friends joined · {rupees(referral.earned)} earned
              </p>
            </>
          ) : (
            <p className="text-[13px] leading-[1.6] text-ink-55 mt-3 mb-0">
              Referral codes are coming soon — you&apos;ll get yours here.
            </p>
          )}
        </Card>
      </div>

      {liveOrders.length > 0 && (
        <div>
          <SectionTitle>Track your order</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-3 stagger">
            {liveOrders.map((order) => {
              const type = order.fulfillmentType === 'delivery' ? 'pantry' : 'kitchen';
              const t = ORDER_TYPES[type];
              const steps =
                type === 'pantry'
                  ? ['Ordered', 'Shipped', 'Delivered']
                  : ['Placed', 'Preparing', 'Ready', 'Handed over'];
              const current = Math.max(
                0,
                (type === 'pantry'
                  ? ['pending', 'shipped', 'delivered']
                  : ['pending', 'preparing', 'ready', 'completed']
                ).indexOf(order.status)
              );
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-card border border-line-10 p-5 lift"
                  style={{ borderTop: `3px solid ${t.color}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] m-0" style={{ color: t.color }}>
                      {t.label}
                    </p>
                    <span className="text-[11px] text-ink-55 capitalize">{order.status}</span>
                  </div>
                  <h3 className="text-[14px] font-medium text-ink mt-2 mb-4">
                    {(order.items || []).map((i) => `${i.quantity}× ${i.name}`).join(' · ') || `Order #${order.orderNumber}`}
                  </h3>
                  <ProgressSteps steps={steps} current={current} type={type} />
                  <p className="text-[12px] text-ink-55 mt-4 mb-0">
                    #{order.orderNumber} · {rupees(Math.round(Number(order.totalAmount) || 0))}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Previous orders</SectionTitle>
        {loading ? (
          <div className="bg-white rounded-card border border-line-10 p-8">
            <div className="h-4 bg-cream rounded animate-pulse w-1/3" />
          </div>
        ) : (
          <OrdersTable orders={pastOrders} />
        )}
      </div>
    </div>
  );
}

function OrdersTable({ orders }) {
  const rows = orders ?? [];

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-card border border-line-10 p-8 text-center">
        <p className="text-[13.5px] text-ink-55 m-0">No orders yet.</p>
        <Button to="/shop" variant="primary" size="sm" className="mt-4">Browse the shop</Button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-card border border-line-10 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-cream">
              {['Order', 'Items', 'Total', ''].map((h) => (
                <th
                  key={h}
                  className="text-left font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-55 font-medium px-4 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line-08 last:border-0">
                <td className="p-4 align-top w-[110px]">
                  <p className="font-mono text-[11.5px] text-ink m-0">
                    {o.orderNumber ? `SU-${o.orderNumber}` : o.id}
                  </p>
                  <p className="text-[11.5px] text-ink-50 m-0 mt-0.5">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : o.date}
                  </p>
                </td>
                <td className="p-4 align-top">
                  <p className="text-[13px] text-ink m-0">
                    {o.items && Array.isArray(o.items)
                      ? o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')
                      : o.items}
                  </p>
                  <p className="text-[11.5px] text-ink-55 m-0 mt-0.5">
                    {o.fulfillmentType === 'delivery' ? 'Pantry' : o.type || 'Eat now'} ·{' '}
                    {o.status || 'Delivered'}
                  </p>
                </td>
                <td className="p-4 align-top text-[13px] font-medium text-ink tabular-nums w-[80px]">
                  {rupees(o.totalAmount ?? o.total)}
                </td>
                <td className="p-4 align-top w-[170px]">
                  <div className="flex gap-2 justify-end">
                    <Button variant="dark" size="sm" className="!text-[11.5px] !py-1.5 !px-3">Reorder</Button>
                    <Button variant="outline" size="sm" className="!text-[11.5px] !py-1.5 !px-3">Invoice</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Orders() {
  const { orders, loading } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">Orders</h1>
      {loading ? (
        <div className="bg-white rounded-card border border-line-10 p-8">
          <div className="h-4 bg-cream rounded animate-pulse w-1/3" />
        </div>
      ) : (
        <OrdersTable orders={orders} />
      )}
    </div>
  );
}

function Plans() {
  const { plans } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">My plans</h1>
      {plans.supported && plans.items.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.items.map((pl) => (
            <Card key={pl.id}>
              <h2 className="text-[14px] font-medium text-ink m-0">{pl.product}</h2>
              <p className="text-[12px] text-ink-55 m-0 mt-1">
                {pl.frequency} · {rupees(pl.perDelivery)} per delivery
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <NotYet
          title="Subscriptions aren't live yet"
          blurb="You can design a plan in the builder today — pricing and schedule are real — but plans aren't stored on your account until the subscription service ships."
          cta={<Button to="/subscribe" variant="primary" size="sm" className="mt-4">Open the plan builder</Button>}
        />
      )}
    </div>
  );
}

function Wallet() {
  const { wallet } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">Wallet</h1>
      {wallet.supported ? (
        <div className="grid gap-5 md:grid-cols-[300px_1fr] items-start">
          <WalletCard />
          <Card>
            <SectionTitle>Activity</SectionTitle>
            <ul className="list-none p-0 m-0">
              {wallet.ledger.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-3 border-b border-line-08 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink m-0 truncate">{row.label}</p>
                    <p className="text-[11.5px] text-ink-50 m-0 mt-0.5">{row.date}</p>
                  </div>
                  <span
                    className="text-[13px] font-medium tabular-nums shrink-0"
                    style={{ color: row.amount < 0 ? 'var(--color-ink-55)' : 'var(--color-olive)' }}
                  >
                    {row.amount < 0 ? '−' : '+'}{rupees(Math.abs(row.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <NotYet
          title="Your wallet isn't live yet"
          blurb="Plan balance and spendable credit arrive with the subscription service. Nothing has been deducted from you, and no balance is being held."
        />
      )}
    </div>
  );
}

function Addresses() {
  const { addresses } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">Addresses</h1>
      {addresses.supported && addresses.items.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {addresses.items.map((a) => (
            <Card key={a.id}>
              <p className="text-[13.5px] font-medium text-ink m-0">{a.label}</p>
              <p className="text-[12.5px] text-ink-60 m-0 mt-1.5">{a.line}</p>
            </Card>
          ))}
        </div>
      ) : (
        <NotYet
          title="No saved addresses yet"
          blurb="An address book is on the way. For now, enter your delivery address at checkout — it is saved with that order."
          cta={<Button to="/shop" variant="primary" size="sm" className="mt-4">Start an order</Button>}
        />
      )}
    </div>
  );
}

function Referrals() {
  const { referral } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">Refer &amp; earn</h1>
      {referral.supported ? (
        <div className="bg-ink text-paper rounded-card p-8 text-center">
          <p className="text-[14px] text-paper/70 m-0">Give ₹150, get ₹150</p>
          <p className="font-mono text-[28px] tracking-[0.14em] mt-4 mb-0">{referral.code}</p>
        </div>
      ) : (
        <NotYet
          title="Referral codes aren't live yet"
          blurb="When they ship you'll get a personal code here, and both of you get spendable credit after their first order."
        />
      )}
    </div>
  );
}

function Profile() {
  const { displayName, phone, email, memberSince } = useAccount();
  const rows = [
    ['Username', displayName],
    ['Mobile', phone || '—'],
    ['Email', email || '—'],
    ['Member since', memberSince || '—']
  ];
  return (
    <div className="space-y-6">
      <h1 className="font-display text-[32px] text-ink m-0">Profile &amp; settings</h1>
      <Card className="max-w-[480px] space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2 border-b border-line-08 last:border-0">
            <span className="text-[12.5px] text-ink-55">{label}</span>
            <span className="text-[13px] text-ink break-all">{value}</span>
          </div>
        ))}
        {/* TODO: Handle core functionality later — no profile-update endpoint yet. */}
        <p className="text-[11.5px] leading-[1.6] text-ink-50 m-0 pt-1">
          To change any of these, email{' '}
          <a href="mailto:info@spoonupfoods.com" className="underline">support</a>.
        </p>
      </Card>
    </div>
  );
}

export default function Account() {
  const { user, checking, logout } = useUser();
  const navigate = useNavigate();

  // The handoff treats 3b as a signed-in screen; without this a stranger landed
  // on the sample customer's name, orders and wallet.
  if (checking) {
    return (
      <div className="bg-cream min-h-[calc(100vh-88px)] grid place-items-center">
        <p className="text-[13.5px] text-ink-55 m-0">Loading your account…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/signin?next=/account" replace />;

  const displayName = user.username;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="bg-cream min-h-[calc(100vh-88px)]">
      <Container className="py-[34px] grid gap-8 lg:grid-cols-[230px_1fr] items-start">
        <aside className="lg:sticky lg:top-28">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-9 h-9 rounded-full bg-olive text-paper grid place-items-center text-[13px] font-medium">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink m-0 truncate">{displayName}</p>
              <p className="text-[11.5px] text-ink-50 m-0">{user.phone}</p>
            </div>
          </div>

          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3.5 py-2.5 text-[13px] whitespace-nowrap pressable ${
                    isActive ? 'bg-ink text-paper font-medium' : 'text-ink-72 hover:bg-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-5 pt-5 border-t border-line-12 flex lg:flex-col gap-1.5">
            <Link to="/our-story" className="rounded-md px-3.5 py-2.5 text-[13px] text-ink-72 hover:bg-white transition">
              Help &amp; support
            </Link>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="text-left rounded-md px-3.5 py-2.5 text-[13px] text-ink-72 hover:bg-white transition cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="orders" element={<Orders />} />
            <Route path="plans" element={<Plans />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="addresses" element={<Addresses />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/account" replace />} />
          </Routes>
        </div>
      </Container>
    </div>
  );
}
