import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';

import AdminLayout from './AdminLayout';
import AdminOrdersPage from './AdminOrdersPage';
import AdminTakeOrder from './AdminTakeOrder';
import AdminCoupons from './AdminCoupons';
import AdminCustomers from './AdminCustomers';
import AdminPlaceholder from './AdminPlaceholder';

import AdminProducts from '../components/AdminProducts';
import AdminSettings from '../components/AdminSettings';
import AdminLogin from './AdminLogin';
import AdminDeliveries from '../components/AdminDeliveries';
import {
  ADMIN_SESSION_EXPIRED_EVENT,
  clearAdminSession,
  getAdminSession
} from '../lib/adminSession';
import { useAdminOrders } from '../hooks/useAdminOrders';

/**
 * Staff dashboard. The handoff's screens (1d Orders, 1e Take an order, 1f Coupons)
 * are built in the new design language; the remaining sidebar sections are
 * placeholders. Products and Settings still use the previous components because
 * they are wired to live endpoints and the handoff does not redesign them.
 */
export default function AdminApp() {
  const navigate = useNavigate();
  const [adminToken, setAdminToken] = useState(() => getAdminSession());
  const [settings, setSettings] = useState({ eventName: 'SpoonUp', currencySymbol: '₹', counterName: 'Main Shop' });
  const [products, setProducts] = useState([]);
  const { orders, connectionError, updateStatus } = useAdminOrders(adminToken);

  const loadData = useCallback(async () => {
    const token = getAdminSession();
    try {
      const [settingsRes, productsRes] = await Promise.all([
        fetch('/api/settings', token ? { headers: { 'x-admin-token': token } } : undefined),
        fetch('/api/products')
      ]);
      if (settingsRes.ok) setSettings(await settingsRes.json());
      if (productsRes.ok) setProducts(await productsRes.json());
    } catch (err) {
      console.error('Failed to load admin data:', err);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(loadData);
    const handleExpired = () => setAdminToken('');
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleExpired);
  }, [loadData]);

  const handleLoginSuccess = (token, newSettings) => {
    setAdminToken(token);
    if (newSettings) setSettings(newSettings);
    navigate('/admin/orders');
  };

  const handleLogout = async () => {
    const token = adminToken || getAdminSession();
    clearAdminSession();
    setAdminToken('');
    navigate('/');
    if (token) {
      try {
        await fetch('/api/admin/logout', { method: 'POST', headers: { 'x-admin-token': token } });
      } catch {
        // best effort
      }
    }
  };

  if (!adminToken) {
    return <AdminLogin onLoginSuccess={handleLoginSuccess} />;
  }

  const liveKitchen = orders.filter(
    (o) => o.fulfillmentType !== 'delivery' && ['pending', 'preparing', 'ready'].includes(o.status)
  ).length;
  const pendingDispatch = orders.filter(
    (o) => o.fulfillmentType === 'delivery' && ['pending', 'shipped'].includes(o.status)
  ).length;
  const counts = { orders: liveKitchen, dispatch: pendingDispatch, products: products.length };

  return (
    <Routes>
      <Route
        element={
          <AdminLayout
            onLogout={handleLogout}
            counts={counts}
            settings={settings}
          />
        }
      >
        <Route index element={<Navigate to="orders" replace />} />
        <Route
          path="orders"
          element={
            <AdminOrdersPage
              orders={orders}
              updateStatus={updateStatus}
              adminToken={adminToken}
              connectionError={connectionError}
            />
          }
        />
        <Route path="deliveries" element={<AdminDeliveries adminPin={adminToken} settings={settings} />} />
        <Route
          path="take-order"
          element={
            <AdminTakeOrder
              products={products}
              orders={orders}
              adminToken={adminToken}
              onPlaced={loadData}
            />
          }
        />
        <Route path="coupons" element={<AdminCoupons />} />

        {/* Live, wired to real endpoints — kept on the previous components. */}
        <Route
          path="products"
          element={
            <AdminProducts
              products={products}
              onRefreshProducts={loadData}
              adminPin={adminToken}
              settings={settings}
            />
          }
        />
        <Route
          path="settings"
          element={<AdminSettings adminPin={adminToken} settings={settings} onRefreshSettings={loadData} />}
        />

        <Route
          path="subscriptions"
          element={<AdminPlaceholder needs="A plans table (product, rhythm, duration, wallet balance), a delivery scheduler, and skip/pause endpoints. Nothing about subscriptions is stored on the server yet." title="Subscriptions" blurb="Active, paused and churned plans per product, with the delivery calendar." />}
        />
        <Route path="customers" element={<AdminCustomers orders={orders} />} />
        <Route
          path="payments"
          element={<AdminPlaceholder needs="A wallet ledger with plan and spendable balances, plus a manual adjustment endpoint. Razorpay payments are recorded on the order today, not in a ledger." title="Payments & wallets" blurb="Global transaction ledger plus the manual adjustment and refund tool." />}
        />
        <Route
          path="pricing"
          element={<AdminPlaceholder needs="A per-channel price table. Orders currently carry no channel, so web, Android and iOS cannot be told apart." title="Pricing by channel" blurb="Per-platform margins for web, Android and iOS." />}
        />
        <Route
          path="referrals"
          element={<AdminPlaceholder needs="Per-customer referral codes, an attribution log and a payout rule. No code is issued anywhere yet." title="Referrals" blurb="Bonus rules and the payout log." />}
        />

        <Route path="*" element={<Navigate to="orders" replace />} />
      </Route>
    </Routes>
  );
}
