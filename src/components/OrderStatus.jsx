import React, { useEffect, useState } from 'react';
import { 
  Clock, 
  ChefHat, 
  Bell, 
  CheckCircle2, 
  ArrowLeft, 
  RotateCw, 
  MapPin,
  ShieldAlert,
  ShieldCheck,
  CreditCard,
  Sparkles
} from 'lucide-react';

const UPI_PHONE = '+91 91165 08320';
const UPI_ID = 'anshitakhandelwal7-1@okhdfcbank';

export default function OrderStatus({ 
  orderId, 
  initialOrder, 
  onBackToMenu, 
  currencySymbol = '₹',
  userToken = '',
  currentUser = null
}) {
  const [order, setOrder] = useState(initialOrder);
  const [orders, setOrders] = useState(initialOrder ? [initialOrder] : []);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const getSecretToken = (targetId) => {
    if (initialOrder?.accessToken) return initialOrder.accessToken;
    try {
      const tokens = JSON.parse(localStorage.getItem('order_tokens') || '{}');
      return tokens[targetId] || tokens[String(initialOrder?.orderNumber)] || '';
    } catch {
      return '';
    }
  };

  const fetchLatestStatus = async () => {
    try {
      setIsRefreshing(true);
      if (userToken) {
        const res = await fetch('/api/me/orders', { headers: { 'x-user-token': userToken } });
        if (res.ok) {
          const list = await res.json();
          setOrders(list);
          const selected = list.find(o => o.id === (order?.id || orderId)) || list[0] || null;
          setOrder(selected);
          setAccessDenied(false);
          return;
        }
      } else {
        try {
          const stored = JSON.parse(localStorage.getItem('my_orders') || '[]');
          if (stored.length > 1) setOrders(stored);
        } catch {}
      }

      if (!orderId && !initialOrder?.id) return;
      const targetId = order?.id || orderId || initialOrder.id;
      const token = getSecretToken(targetId);
      const headers = {};
      if (token) headers['x-order-token'] = token;
      const res = await fetch(`/api/orders/${targetId}`, { headers });
      if (res.status === 403 || res.status === 401 || res.status === 404) {
        setAccessDenied(true);
        return;
      }
      if (!res.ok) throw new Error('Could not fetch order update');
      const data = await res.json();
      setOrder(data);
      setOrders((prev) => {
        const others = prev.filter(o => o.id !== data.id);
        return [data, ...others];
      });
      setAccessDenied(false);
    } catch (err) {
      console.warn('Poll error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLatestStatus();
    const interval = setInterval(fetchLatestStatus, 4000);
    return () => clearInterval(interval);
  }, [orderId, initialOrder?.id, userToken]);

  if (accessDenied) {
    return (
      <div className="max-w-md mx-auto p-6 text-center py-16">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-rose-200">
          <ShieldAlert size={24} />
        </div>
        <h3 className="text-base font-bold text-[#013e37]">Protected Order</h3>
        <p className="text-xs text-[#013e37]/70 mt-1.5 leading-relaxed">
          This order cannot be accessed without its original secret access token. Neighboring order inspection is strictly prevented to protect customer privacy.
        </p>
        <button
          onClick={onBackToMenu}
          className="mt-5 px-4 py-2 bg-[#013e37] text-[#ffefb3] text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
        >
          Return to Menu
        </button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-md mx-auto p-6 text-center py-20">
        <p className="text-[#013e37]/60 text-sm">
          {currentUser ? 'No orders on this account yet.' : 'Loading order status...'}
        </p>
        <button onClick={onBackToMenu} className="mt-4 text-xs font-bold text-[#013e37] underline cursor-pointer">
          Back to menu
        </button>
      </div>
    );
  }

  const isDelivery = order.fulfillmentType === 'delivery';
  const steps = isDelivery
    ? [
        { key: 'pending', label: 'Packed', desc: 'Preparing shipment', icon: CreditCard },
        { key: 'shipped', label: 'Shipped', desc: 'On the way', icon: MapPin },
        { key: 'delivered', label: 'Delivered', desc: 'Received', icon: CheckCircle2 },
      ]
    : [
        { key: 'pending', label: 'Payment', desc: 'Pay at Counter / UPI', icon: CreditCard },
        { key: 'preparing', label: 'Preparing', desc: 'Kitchen Prepping', icon: ChefHat },
        { key: 'ready', label: 'Ready', desc: 'Pickup at Main Shop', icon: Bell },
        { key: 'completed', label: 'Collected', desc: 'Enjoy!', icon: CheckCircle2 },
      ];

  const getStepIndex = (st) => {
    if (isDelivery) {
      if (st === 'shipped') return 1;
      if (st === 'delivered') return 2;
      if (st === 'rejected' || st === 'refunded') return 0;
      return 0;
    }
    switch (st) {
      case 'pending': return 0;
      case 'preparing': return 1;
      case 'ready': return 2;
      case 'completed': return 3;
      default: return 0;
    }
  };

  const currentIndex = getStepIndex(order.status);
  const isPending = order.status === 'pending';
  const isPreparing = order.status === 'preparing';
  const isReady = order.status === 'ready';
  const isCompleted = order.status === 'completed';
  const subtotalAmount = Number(order.subtotalAmount ?? order.totalAmount ?? 0);
  const taxAmount = Number(order.taxAmount ?? 0);
  const totalAmount = Number(order.totalAmount ?? 0);
  const upiUrl = `upi://pay?${new URLSearchParams({
    pa: UPI_ID,
    pn: 'SpoonUp',
    am: totalAmount.toFixed(2),
    cu: 'INR',
    tr: `SPOONUP${order.orderNumber}`,
    tn: `SpoonUp Order #${order.orderNumber}`
  }).toString()}`;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {orders.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-3 no-scrollbar">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => setOrder(o)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border cursor-pointer ${
                order.id === o.id
                  ? 'bg-[#013e37] text-[#ffefb3] border-[#013e37]'
                  : 'bg-white text-[#013e37] border-[#e8e5dc]'
              }`}
            >
              #{o.orderNumber} {o.fulfillmentType === 'delivery' ? '· Delivery' : '· Now'}
            </button>
          ))}
        </div>
      )}
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={onBackToMenu}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#013e37] bg-white border border-[#e8e5dc] px-3 py-1.5 rounded-full hover:bg-[#ffefb3]/60 transition cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Menu</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
            <ShieldCheck size={11} />
            <span>End-to-End Private</span>
          </span>

          <button
            onClick={fetchLatestStatus}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1 text-xs text-[#013e37]/70 bg-white border border-[#e8e5dc] px-2.5 py-1.5 rounded-full transition cursor-pointer hover:bg-[#ffefb3]/40"
          >
            <RotateCw size={13} className={isRefreshing ? 'animate-spin text-[#013e37]' : ''} />
            <span>{isRefreshing ? 'Checking...' : 'Live auto-refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-3xl border border-[#e8e5dc] overflow-hidden shadow-sm mb-5">
        {/* Token Banner */}
        <div className={`p-6 text-center transition-all ${
          isReady 
            ? 'bg-[#ffefb3] text-[#013e37] border-b-2 border-[#f0de99]' 
            : 'bg-[#013e37] text-[#ffefb3]'
        }`}>
          <p className="text-[11px] uppercase font-bold tracking-widest opacity-80">
            {isDelivery ? 'Delivery Order Accepted' : 'Order Accepted · Pickup Token'}
          </p>
          <h1 className="text-5xl font-black tracking-tight my-1">
            #{order.orderNumber}
          </h1>
          <p className="text-xs font-medium opacity-90 mt-1">
            {order.customerName} • {order.customerPhone}
          </p>
        </div>

        {/* Status Callout Notices */}
        {isPending && !isDelivery && (
          <div className="bg-[#fffdf5] border-b border-[#f0de99] p-4 text-center">
            <div className="inline-flex items-center gap-1.5 text-[#013e37] font-bold text-xs sm:text-sm">
              <CreditCard className="w-4 h-4 text-amber-700" />
              <span>Awaiting Payment ({currencySymbol}{order.totalAmount})</span>
            </div>
            <p className="text-xs text-[#013e37]/80 mt-1 leading-relaxed">
              Pay <strong className="font-bold">{currencySymbol}{totalAmount.toFixed(2)}</strong> to{' '}
              <strong>{UPI_ID}</strong> ({UPI_PHONE}) using any UPI app, or pay at{' '}
              <strong>{order.counterName || 'Main Shop'}</strong>.
            </p>
            <a
              href={upiUrl}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#013e37] px-5 py-2.5 text-xs font-bold text-[#ffefb3]"
            >
              <CreditCard size={15} />
              Open UPI App
            </a>
            <p className="text-[11px] text-[#013e37]/65 mt-2">
              Your phone will show available apps such as GPay, PhonePe or Paytm. Payment confirmation is not automatic yet—please show or send the payment screenshot to the counter.
            </p>
          </div>
        )}

        {isPreparing && (
          <div className="bg-[#f0fdf4] border-b border-emerald-200 p-4 text-center">
            <div className="inline-flex items-center gap-1.5 text-emerald-900 font-bold text-xs sm:text-sm">
              <ChefHat className="w-4 h-4 text-emerald-700 animate-pulse" />
              <span>Payment Confirmed • Kitchen Preparing</span>
            </div>
            <p className="text-xs text-emerald-800/80 mt-1">
              Your order is being freshly prepared with care. We'll alert you the moment it's ready!
            </p>
          </div>
        )}

        {isReady && (
          <div className="bg-[#fff9e6] border-b border-[#f0de99] p-4 text-center">
            <div className="inline-flex items-center gap-1.5 text-[#013e37] font-bold text-base">
              <Bell className="w-5 h-5 text-[#013e37] animate-bounce" />
              <span>YOUR ORDER IS READY!</span>
            </div>
            <p className="text-xs text-[#013e37]/80 mt-1">
              Please present Token <strong className="font-mono font-bold">#{order.orderNumber}</strong> at{' '}
              <strong>{order.counterName || 'Main Shop'}</strong> to collect your items.
            </p>
          </div>
        )}

        {/* Minimal Progress Stepper */}
        <div className="p-6">
          <div className="relative">
            <div className="absolute top-4 left-6 right-6 h-0.5 bg-[#f0ede4] -z-0" />
            <div 
              className="absolute top-4 left-6 h-0.5 bg-[#013e37] -z-0 transition-all duration-500"
              style={{ width: `${(currentIndex / Math.max(steps.length - 1, 1)) * 100}%` }}
            />

            <div className={`grid gap-1 text-center relative z-10 ${steps.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {steps.map((step, idx) => {
                const Icon = step.icon;
                const isPassed = idx < currentIndex;
                const isCurrent = idx === currentIndex;

                return (
                  <div key={step.key} className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all border ${
                        isCurrent
                          ? 'bg-[#013e37] border-[#013e37] text-[#ffefb3] scale-110 shadow-xs'
                          : isPassed
                          ? 'bg-[#ffefb3] border-[#013e37]/30 text-[#013e37]'
                          : 'bg-white border-[#e8e5dc] text-[#013e37]/30'
                      }`}
                    >
                      <Icon size={14} />
                    </div>
                    <span className={`text-[11px] mt-1.5 font-semibold ${
                      isCurrent ? 'text-[#013e37] font-bold' : isPassed ? 'text-[#013e37]/80' : 'text-[#013e37]/40'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pickup location indicator */}
          <div className="mt-6 p-3 bg-[#faf9f5] rounded-2xl border border-[#e8e5dc] flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#ffefb3] text-[#013e37] flex items-center justify-center shrink-0 border border-[#f0de99]">
              <MapPin size={16} />
            </div>
            <div className="text-xs">
              <p className="font-bold text-[#013e37]">{isDelivery ? 'Delivery address' : 'Pickup Location'}</p>
              <p className="text-[#013e37]/70">
                {isDelivery
                  ? [order.deliveryAddress?.line1, order.deliveryAddress?.city, order.deliveryAddress?.pincode].filter(Boolean).join(', ')
                  : (order.counterName || 'Main Shop')}
              </p>
              {isDelivery && order.trackingLink && (
                <a href={order.trackingLink} target="_blank" rel="noreferrer" className="text-[#013e37] underline">
                  Track shipment
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Order Details Breakdown */}
        <div className="p-5 bg-[#faf9f5] border-t border-[#e8e5dc] space-y-2.5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#013e37]/60">
            Order Items
          </h4>
          <div className="space-y-1.5">
            {(order.items || []).map((item, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <span className="text-[#013e37]">
                  <span className="font-bold text-[#013e37] font-mono">{item.quantity}x</span> {item.name}
                </span>
                <span className="font-semibold text-[#013e37]">
                  {currencySymbol}{item.subtotal || item.price * item.quantity}
                </span>
              </div>
            ))}
          </div>

          {order.notes && (
            <div className="text-xs text-[#013e37]/80 italic bg-white p-2 rounded-xl border border-[#e8e5dc]">
              "{order.notes}"
            </div>
          )}

          <div className="pt-2.5 border-t border-[#e8e5dc] flex justify-between items-center font-black text-sm text-[#013e37]">
            <span>Subtotal</span>
            <span>{currencySymbol}{subtotalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-xs text-[#013e37]/70">
            <span>GST</span>
            <span>{currencySymbol}{taxAmount.toFixed(2)}</span>
          </div>
          <div className="pt-2.5 border-t border-[#e8e5dc] flex justify-between items-center font-black text-sm text-[#013e37]">
            <span>Total</span>
            <span className="text-[#013e37] text-base">
              {currencySymbol}{totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Button to order more */}
      <button
        onClick={onBackToMenu}
        className="w-full py-3 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] text-xs font-bold rounded-2xl shadow-xs transition cursor-pointer"
      >
        Order More Items
      </button>
    </div>
  );
}
