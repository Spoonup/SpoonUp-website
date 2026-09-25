import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountContext } from './accountContextObject';
import { useUser } from './useUser';
import { api } from './api';

/**
 * Everything the account screens show about *this* customer, derived from the
 * signed-in user record and their real orders (`GET /api/me/orders`).
 *
 * Wallet, subscription plans, referrals and a saved-address book have no server
 * model yet. They are exposed as explicit empty values with `supported: false`
 * so screens can render an honest "not available yet" state instead of sample
 * numbers that belong to nobody.
 */

const LIVE_KITCHEN = ['pending', 'preparing', 'ready'];
const LIVE_DELIVERY = ['pending', 'shipped'];

function monthYear(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function isDelivery(order) {
  return order.fulfillmentType === 'delivery';
}

export function AccountProvider({ children }) {
  const { user, checking } = useUser();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user) {
      setOrders([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.myOrders();
      setOrders(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Deferred a tick so the effect never sets state synchronously.
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const value = useMemo(() => {
    const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const live = sorted.filter((o) =>
      (isDelivery(o) ? LIVE_DELIVERY : LIVE_KITCHEN).includes(o.status)
    );
    const past = sorted.filter((o) => !live.includes(o));

    return {
      user,
      checking,
      loading,
      error,
      refresh,

      // real, per-customer
      orders: sorted,
      liveOrders: live,
      pastOrders: past,
      orderCount: sorted.length,
      memberSince: monthYear(user?.createdAt),
      displayName: user?.username || '',
      initials: (user?.username || '').slice(0, 2).toUpperCase(),
      email: user?.email || '',
      phone: user?.phone || '',

      // no server model yet — screens must show an unavailable state, not samples
      wallet: { supported: false, total: 0, planBalance: 0, spendable: 0, ledger: [] },
      plans: { supported: false, items: [] },
      addresses: { supported: false, items: [] },
      referral: { supported: false, code: '', joined: 0, earned: 0 }
    };
  }, [orders, user, checking, loading, error, refresh]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
