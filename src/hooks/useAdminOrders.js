import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '../lib/adminSession';

const POLL_INTERVAL_MS = 4000;

/**
 * Shared polling loop for the admin screens: loads orders + stats, exposes a manual
 * refresh, reports connection problems, and fires `onNewPending` when the number of
 * pending kitchen orders grows (used for the chime).
 */
export function useAdminOrders(adminToken, { onNewPending } = {}) {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const prevPendingCountRef = useRef(null);
  const onNewPendingRef = useRef(onNewPending);
  useEffect(() => {
    onNewPendingRef.current = onNewPending;
  }, [onNewPending]);

  const refresh = useCallback(
    async (isManual = false) => {
      if (!adminToken) return;
      try {
        if (isManual) setIsRefreshing(true);
        const [ordersRes, statsRes] = await Promise.all([
          adminFetch('/api/orders', adminToken),
          adminFetch('/api/stats', adminToken)
        ]);
        if (!ordersRes.ok || !statsRes.ok) {
          setConnectionError(
            ordersRes.status === 429 ? 'Too many requests; slowing down.' : 'Could not refresh orders.'
          );
          return;
        }
        const ordersData = await ordersRes.json();
        const statsData = await statsRes.json();

        const pendingCount = ordersData.filter(
          (o) => o.fulfillmentType !== 'delivery' && o.status === 'pending'
        ).length;
        if (prevPendingCountRef.current !== null && pendingCount > prevPendingCountRef.current) {
          onNewPendingRef.current?.();
        }
        prevPendingCountRef.current = pendingCount;

        setOrders(ordersData);
        setStats(statsData);
        setConnectionError('');
      } catch (err) {
        console.error('Error fetching admin data:', err);
        setConnectionError('Connection lost. Retrying…');
      } finally {
        if (isManual) setIsRefreshing(false);
      }
    },
    [adminToken]
  );

  useEffect(() => {
    // First load is deferred a tick so the effect itself never sets state synchronously.
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  const updateStatus = useCallback(
    async (orderId, status, extra = {}) => {
      const res = await adminFetch(`/api/orders/${orderId}/status`, adminToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update order');
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data : o)));
      refresh();
      return data;
    },
    [adminToken, refresh]
  );

  return { orders, stats, isRefreshing, connectionError, refresh, updateStatus };
}
