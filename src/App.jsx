import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import SiteLayout from './components/layout/SiteLayout';
import ScrollToTop from './components/ScrollToTop';
import CartToast from './components/ui/CartToast';
import { CartProvider } from './lib/CartContext';
import { CatalogueProvider } from './lib/CatalogueContext';
import { UserProvider } from './lib/UserContext';
import { AccountProvider } from './lib/AccountContext';
import { ServiceAreaProvider } from './lib/ServiceAreaContext';
import PincodePicker from './components/ui/PincodePicker';

import Home from './pages/Home';
import Shop from './pages/Shop';
import Subscribe from './pages/Subscribe';
import Cart from './pages/Cart';
import OurStory from './pages/OurStory';
import Checkout from './pages/Checkout';
import OrderConfirmed from './pages/OrderConfirmed';
import Account from './pages/Account';
import SignIn from './pages/SignIn';
import CheckoutLayout from './components/layout/CheckoutLayout';
import NotFound from './pages/NotFound';
import Placeholder from './pages/Placeholder';
import AdminApp from './admin/AdminApp';

const LEGAL = {
  terms: 'Terms & conditions',
  privacy: 'Privacy policy',
  returns: 'Returns & refunds',
  shipping: 'Shipping policy',
  wallet: 'Wallet & subscription terms'
};

export default function App() {
  return (
    <UserProvider>
    <AccountProvider>
    <ServiceAreaProvider>
    <CatalogueProvider>
    <CartProvider>
      <ScrollToTop />
      <Routes>
        {/* Customer-facing site */}
        <Route element={<SiteLayout />}>
          <Route index element={<Home />} />
          <Route path="shop" element={<Shop />} />
          <Route path="subscribe" element={<Subscribe />} />
          <Route path="cart" element={<Cart />} />
          <Route path="our-story" element={<OurStory />} />

          <Route path="account/*" element={<Account />} />
          <Route path="signin" element={<SignIn />} />

          {Object.entries(LEGAL).map(([slug, title]) => (
            <Route
              key={slug}
              path={`legal/${slug}`}
              element={<Placeholder title={title} blurb="Final policy copy is pending from the product owner." batch="content sign-off" />}
            />
          ))}

          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Checkout flow uses minimal chrome (no nav, no full footer) */}
        <Route element={<CheckoutLayout />}>
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order-confirmed" element={<OrderConfirmed />} />
        </Route>

        {/* Existing staff dashboard — unchanged, still on the previous design.
            The handoff's admin screens (1d/1e/1f) are a later phase. */}
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/status" element={<Navigate to="/account" replace />} />
      </Routes>

      <CartToast />
      <PincodePicker />
    </CartProvider>
    </CatalogueProvider>
    </ServiceAreaProvider>
    </AccountProvider>
    </UserProvider>
  );
}
