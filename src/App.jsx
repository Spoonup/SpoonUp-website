import React, { useState, useEffect } from 'react';
import { 
  ClipboardList, 
  Package, 
  Settings as SettingsIcon, 
  LogOut, 
  Lock, 
  ShoppingBag,
  Clock,
  Sparkles
} from 'lucide-react';
import CustomerMenu from './components/CustomerMenu';
import OrderStatus from './components/OrderStatus';
import AdminOrders from './components/AdminOrders';
import AdminProducts from './components/AdminProducts';
import AdminSettings from './components/AdminSettings';
import AdminLoginModal from './components/AdminLoginModal';

// Helper to determine view based on browser URL pathname
const parseRoute = (pathname, loggedIn) => {
  const clean = (pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/admin' || clean === '/admin/orders') {
    return { view: 'admin_orders', needsAuth: !loggedIn, path: '/admin/orders' };
  }
  if (clean === '/admin/products') {
    return { view: 'admin_products', needsAuth: !loggedIn, path: '/admin/products' };
  }
  if (clean === '/admin/settings') {
    return { view: 'admin_settings', needsAuth: !loggedIn, path: '/admin/settings' };
  }
  if (clean === '/status') {
    return { view: 'status', needsAuth: false, path: '/status' };
  }
  return { view: 'menu', needsAuth: false, path: '/' };
};

export default function App() {
  const [view, setView] = useState('menu'); // 'menu' | 'status' | 'admin_orders' | 'admin_products' | 'admin_settings'
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState({
    eventName: 'SpoonUp',
    currencySymbol: '₹',
    counterName: 'Main Pickup Counter #1'
  });
  const [cart, setCart] = useState([]);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial settings and products
  const loadData = async () => {
    try {
      setIsLoading(true);
      const [settingsRes, productsRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/products')
      ]);

      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setSettings(s);
      }
      if (productsRes.ok) {
        const p = await productsRes.json();
        setProducts(p);
      }
    } catch (err) {
      console.error('Failed to load initial app data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Navigate and update browser URL
  const navigateTo = (newView, customPath) => {
    setView(newView);
    let path = customPath;
    if (!path) {
      if (newView === 'menu') path = '/';
      else if (newView === 'status') path = '/status';
      else if (newView === 'admin_orders') path = '/admin/orders';
      else if (newView === 'admin_products') path = '/admin/products';
      else if (newView === 'admin_settings') path = '/admin/settings';
    }
    if (path && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  useEffect(() => {
    loadData();

    const savedPin = localStorage.getItem('admin_pin');
    const loggedIn = Boolean(savedPin);
    if (savedPin) {
      setAdminPin(savedPin);
      setIsAdminLoggedIn(true);
    }

    const myOrders = JSON.parse(localStorage.getItem('my_orders') || '[]');
    if (myOrders.length > 0) {
      setCurrentOrder(myOrders[0]);
    }

    // Handle initial URL route (e.g. user typed /wp-admin or /admin in address bar)
    const initialRoute = parseRoute(window.location.pathname, loggedIn);
    if (initialRoute.needsAuth) {
      setView('menu');
      setIsLoginModalOpen(true);
    } else {
      setView(initialRoute.view);
    }

    // Handle browser Back / Forward buttons
    const handlePopState = () => {
      const pin = localStorage.getItem('admin_pin');
      const isAuth = Boolean(pin);
      const route = parseRoute(window.location.pathname, isAuth);
      if (route.needsAuth) {
        setView('menu');
        setIsLoginModalOpen(true);
      } else {
        setView(route.view);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleLoginSuccess = (pin, newSettings) => {
    setAdminPin(pin);
    setIsAdminLoggedIn(true);
    setIsLoginModalOpen(false);
    if (newSettings) setSettings(newSettings);
    navigateTo('admin_orders', '/admin/orders');
  };

  const handleLoginModalClose = () => {
    setIsLoginModalOpen(false);
    // If user cancelled login modal without logging in, return URL to '/'
    const savedPin = localStorage.getItem('admin_pin');
    if (!savedPin && !isAdminLoggedIn) {
      const clean = window.location.pathname.toLowerCase();
      if (clean.includes('admin') || clean.includes('dashboard')) {
        window.history.pushState(null, '', '/');
        setView('menu');
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_pin');
    setAdminPin('');
    setIsAdminLoggedIn(false);
    navigateTo('menu', '/');
  };

  const handleOrderPlaced = (newOrder) => {
    setCurrentOrder(newOrder);
    navigateTo('status', '/status');
  };

  const isAdminView = view.startsWith('admin_');

  return (
    <div className="min-h-screen bg-[#faf9f5] text-[#013e37] flex flex-col font-sans selection:bg-[#ffefb3] selection:text-[#013e37]">
      {/* Top Minimal Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#faf9f5]/90 backdrop-blur-md border-b border-[#e8e5dc]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand Logo & Name */}
          <div 
            onClick={() => navigateTo('menu', '/')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <img
              src="/SpoonUp_Official_Logo_Transparent.png"
              alt="SpoonUp"
              className="h-10 w-auto object-contain transition-transform group-hover:scale-105"
            />
            <div className="hidden sm:block">
              <span className="text-[11px] font-semibold text-[#013e37]/60 uppercase tracking-widest block leading-tight">
                {isAdminView ? 'Staff Dashboard' : 'Small Indulgences. Big Impact.'}
              </span>
            </div>
          </div>

          {/* Right Navigation Actions */}
          <div className="flex items-center gap-2">
            {!isAdminView ? (
              <>
                {/* Customer View: Only shows Active Order Tracker if customer has placed an order */}
                {currentOrder && (
                  <button
                    onClick={() => navigateTo('status', '/status')}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer border ${
                      view === 'status' 
                        ? 'bg-[#ffefb3] text-[#013e37] border-[#013e37]/20 font-bold' 
                        : 'bg-white hover:bg-[#ffefb3]/60 text-[#013e37] border-[#e8e5dc]'
                    }`}
                  >
                    <Clock size={13} className="text-[#013e37]" />
                    <span>Order #{currentOrder.orderNumber}</span>
                  </button>
                )}
                {/* Notice: Admin button is completely hidden from customer view */}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigateTo('menu', '/')}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#ffefb3] hover:bg-[#ffefb3]/80 text-[#013e37] transition flex items-center gap-1.5 cursor-pointer border border-[#013e37]/20"
                >
                  <ShoppingBag size={13} />
                  <span>Customer Menu</span>
                </button>

                <button
                  onClick={handleLogout}
                  className="p-1.5 text-[#013e37]/60 hover:text-[#013e37] hover:bg-[#ffefb3]/50 rounded-full transition cursor-pointer"
                  title="Logout"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Minimal Sub-nav for Admin Portal */}
        {isAdminView && (
          <div className="border-t border-[#e8e5dc] bg-[#f5f3eb] px-4 sm:px-6">
            <div className="max-w-5xl mx-auto flex items-center gap-2 overflow-x-auto py-2 no-scrollbar">
              <button
                onClick={() => navigateTo('admin_orders', '/admin/orders')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                  view === 'admin_orders'
                    ? 'bg-[#013e37] text-[#ffefb3]'
                    : 'bg-white hover:bg-[#ffefb3]/50 text-[#013e37] border border-[#e8e5dc]'
                }`}
              >
                <ClipboardList size={14} />
                <span>Live Orders</span>
              </button>

              <button
                onClick={() => navigateTo('admin_products', '/admin/products')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                  view === 'admin_products'
                    ? 'bg-[#013e37] text-[#ffefb3]'
                    : 'bg-white hover:bg-[#ffefb3]/50 text-[#013e37] border border-[#e8e5dc]'
                }`}
              >
                <Package size={14} />
                <span>Menu & Stock</span>
              </button>

              <button
                onClick={() => navigateTo('admin_settings', '/admin/settings')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                  view === 'admin_settings'
                    ? 'bg-[#013e37] text-[#ffefb3]'
                    : 'bg-white hover:bg-[#ffefb3]/50 text-[#013e37] border border-[#e8e5dc]'
                }`}
              >
                <SettingsIcon size={14} />
                <span>Settings & Standee</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Minimal Viewport */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6">
        {view === 'menu' && (
          <CustomerMenu
            products={products}
            settings={settings}
            cart={cart}
            setCart={setCart}
            onOrderPlaced={handleOrderPlaced}
            onOpenMyOrders={() => setView('status')}
          />
        )}

        {view === 'status' && (
          <OrderStatus
            orderId={currentOrder?.id}
            initialOrder={currentOrder}
            onBackToMenu={() => setView('menu')}
            currencySymbol={settings.currencySymbol}
          />
        )}

        {view === 'admin_orders' && (
          <AdminOrders
            adminPin={adminPin}
            settings={settings}
          />
        )}

        {view === 'admin_products' && (
          <AdminProducts
            products={products}
            onRefreshProducts={loadData}
            adminPin={adminPin}
            settings={settings}
          />
        )}

        {view === 'admin_settings' && (
          <AdminSettings
            adminPin={adminPin}
            settings={settings}
            onRefreshSettings={loadData}
          />
        )}
      </main>

      {/* Admin Login Modal */}
      <AdminLoginModal
        isOpen={isLoginModalOpen}
        onClose={handleLoginModalClose}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
