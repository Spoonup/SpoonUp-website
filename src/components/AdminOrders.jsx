import React, { useState, useEffect, useRef } from 'react';
import { 
  Bell, 
  ChefHat, 
  CheckCircle2, 
  Clock, 
  MessageCircle, 
  RotateCw, 
  Volume2, 
  VolumeX, 
  Search, 
  Check, 
  ExternalLink,
  DollarSign,
  XCircle,
  CreditCard,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { playOrderChime } from '../utils/audio';
import { openWhatsAppNotification, buildOrderReadyWhatsAppMessage } from '../utils/whatsapp';

export default function AdminOrders({ adminPin, settings }) {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('active'); // active, pending, preparing, ready, completed, all
  const [searchQuery, setSearchQuery] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const prevPendingCountRef = useRef(0);
  const currency = settings?.currencySymbol || '₹';

  const fetchOrdersAndStats = async (isManual = false) => {
    try {
      if (isManual) setIsRefreshing(true);
      const [ordersRes, statsRes] = await Promise.all([
        fetch('/api/orders', { headers: { 'x-admin-pin': adminPin } }),
        fetch('/api/stats', { headers: { 'x-admin-pin': adminPin } })
      ]);

      if (ordersRes.ok && statsRes.ok) {
        const ordersData = await ordersRes.json();
        const statsData = await statsRes.json();

        const currentPendingCount = ordersData.filter(o => o.status === 'pending').length;
        if (soundEnabled && currentPendingCount > prevPendingCountRef.current && prevPendingCountRef.current !== 0) {
          playOrderChime();
        }
        prevPendingCountRef.current = currentPendingCount;

        setOrders(ordersData);
        setStats(statsData);
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrdersAndStats();
    const interval = setInterval(fetchOrdersAndStats, 4000);
    return () => clearInterval(interval);
  }, [adminPin, soundEnabled]);

  const handleUpdateStatus = async (orderId, newStatus, autoOpenWhatsApp = false, orderObj = null) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': adminPin
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        const updated = await res.json();
        setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
        fetchOrdersAndStats();

        if (autoOpenWhatsApp && (orderObj || updated)) {
          triggerWhatsAppMessage(orderObj || updated);
        }
      }
    } catch (err) {
      alert(`Could not update order: ${err.message}`);
    }
  };

  const triggerWhatsAppMessage = (order) => {
    openWhatsAppNotification(order, settings);
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      String(order.orderNumber).includes(searchQuery) ||
      (order.customerName && order.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (order.customerPhone && order.customerPhone.includes(searchQuery));

    if (!matchesSearch) return false;

    if (activeTab === 'active') return (order.fulfillmentType !== 'delivery') && (order.status === 'pending' || order.status === 'preparing');
    if (activeTab === 'pending') return order.fulfillmentType !== 'delivery' && order.status === 'pending';
    if (activeTab === 'preparing') return order.fulfillmentType !== 'delivery' && order.status === 'preparing';
    if (activeTab === 'ready') return order.status === 'ready';
    if (activeTab === 'completed') return order.status === 'completed';
    return order.fulfillmentType !== 'delivery';
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ffefb3] text-[#013e37] border border-[#f0de99]">
            <CreditCard size={12} className="text-[#013e37]" />
            <span>Awaiting Payment</span>
          </span>
        );
      case 'preparing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#013e37]/10 text-[#013e37] border border-[#013e37]/20">
            <ChefHat size={12} />
            <span>Paid • Kitchen Prep</span>
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#013e37] text-[#ffefb3] border border-[#013e37]">
            <Bell size={12} />
            <span>Ready for Pickup</span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#faf9f5] text-[#013e37]/60 border border-[#e8e5dc]">
            <CheckCircle2 size={12} />
            <span>Completed</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={12} />
            <span>Cancelled</span>
          </span>
        );
      default:
        return null;
    }
  };

  const formatTimeAgo = (isoDate) => {
    try {
      const diffSec = Math.floor((new Date() - new Date(isoDate)) / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      return `${diffHr}h ago`;
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Minimal Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-[#e8e5dc]">
          <span className="text-xs font-semibold text-[#013e37]/70">Total Revenue</span>
          <p className="text-2xl font-black text-[#013e37] mt-1">
            {currency}{stats?.totalRevenue || 0}
          </p>
          <span className="text-[10px] text-[#013e37]/50">Earnings today</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e5dc]">
          <span className="text-xs font-semibold text-[#013e37]/70">Waiting for Payment</span>
          <p className="text-2xl font-black text-[#013e37] mt-1">
            {stats?.pendingCount || 0}
          </p>
          <span className="text-[10px] text-amber-700 font-medium">
            Waiting List • Awaiting cash/UPI
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e5dc]">
          <span className="text-xs font-semibold text-[#013e37]/70">Kitchen Prep (Paid)</span>
          <p className="text-2xl font-black text-[#013e37] mt-1">
            {stats?.preparingCount || 0}
          </p>
          <span className="text-[10px] text-[#013e37]/50">Currently preparing</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#e8e5dc]">
          <span className="text-xs font-semibold text-[#013e37]/70">Ready at Main Shop</span>
          <p className="text-2xl font-black text-[#013e37] mt-1">
            {stats?.readyCount || 0}
          </p>
          <span className="text-[10px] text-[#013e37]/50">Awaiting customer collection</span>
        </div>
      </div>

      {/* Control Strip */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#e8e5dc] flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#013e37]/40" size={15} />
          <input
            type="text"
            placeholder="Search Order #, Customer Name, Phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-xs sm:text-sm text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playOrderChime();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
              soundEnabled 
                ? 'bg-[#ffefb3] text-[#013e37] border-[#f0de99]' 
                : 'bg-white text-[#013e37]/60 border-[#e8e5dc]'
            }`}
          >
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span>{soundEnabled ? 'Bell Chime' : 'Muted'}</span>
          </button>

          <button
            onClick={() => fetchOrdersAndStats(true)}
            disabled={isRefreshing}
            className="p-2 bg-white hover:bg-[#ffefb3]/60 text-[#013e37] rounded-xl border border-[#e8e5dc] transition cursor-pointer"
            title="Refresh Orders"
          >
            <RotateCw size={14} className={isRefreshing ? 'animate-spin text-[#013e37]' : ''} />
          </button>
        </div>
      </div>

      {/* Minimal Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {[
          { id: 'active', label: 'Active Queue', count: (stats?.pendingCount || 0) + (stats?.preparingCount || 0) },
          { id: 'pending', label: 'Waiting List (Unpaid)', count: stats?.pendingCount || 0 },
          { id: 'preparing', label: 'Kitchen Prep (Paid)', count: stats?.preparingCount || 0 },
          { id: 'ready', label: 'Ready for Pickup', count: stats?.readyCount || 0 },
          { id: 'completed', label: 'Completed', count: stats?.completedCount || 0 },
          { id: 'all', label: 'All Orders', count: stats?.totalOrders || 0 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 border ${
              activeTab === tab.id
                ? 'bg-[#013e37] text-[#ffefb3] border-[#013e37]'
                : 'bg-white hover:bg-[#ffefb3]/50 text-[#013e37] border-[#e8e5dc]'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              activeTab === tab.id ? 'bg-[#ffefb3] text-[#013e37]' : 'bg-[#faf9f5] text-[#013e37]/70'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-[#e8e5dc] p-8">
          <ChefHat className="w-10 h-10 text-[#013e37]/30 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-[#013e37]">No orders in this queue</h3>
          <p className="text-xs text-[#013e37]/60 mt-1">Incoming attendee orders will appear in real time.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredOrders.map(order => {
            const isReady = order.status === 'ready';
            const isPreparing = order.status === 'preparing';
            const isPending = order.status === 'pending';
            const isCompleted = order.status === 'completed';

            return (
              <div
                key={order.id}
                className={`bg-white rounded-2xl border transition-all flex flex-col justify-between overflow-hidden ${
                  isReady 
                    ? 'border-[#013e37] ring-2 ring-[#013e37]/10' 
                    : isPending
                    ? 'border-[#f0de99] bg-[#fffdf5]'
                    : 'border-[#e8e5dc]'
                }`}
              >
                {/* Header */}
                <div className="p-3.5 border-b border-[#e8e5dc] flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-black text-[#013e37] tracking-tight">
                        #{order.orderNumber}
                      </span>
                      <span className="text-[10px] text-[#013e37]/50 font-medium">
                        {formatTimeAgo(order.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5">
                      <p className="font-bold text-[#013e37] text-xs leading-snug">{order.customerName}</p>
                      <p className="text-[11px] text-[#013e37]/60 font-mono">
                        {order.customerPhone}
                      </p>
                      <p className="text-[10px] text-[#013e37]/50 font-medium mt-0.5">
                        {order.paymentMethod === 'online' ? 'Paid online' : 'Pay at counter'}
                        {order.paymentStatus === 'paid' ? ' · Paid' : ''}
                      </p>
                    </div>
                  </div>
                  <div>{getStatusBadge(order.status)}</div>
                </div>

                {/* Items */}
                <div className="p-3.5 space-y-1.5 flex-1 text-xs">
                  {(order.items || []).map((item, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-[#013e37]">
                        <span className="font-bold font-mono text-[#013e37] mr-1">{item.quantity}x</span>
                        {item.name}
                      </span>
                      <span className="text-[#013e37]/60 font-mono text-[11px]">
                        {currency}{item.subtotal || item.price * item.quantity}
                      </span>
                    </div>
                  ))}

                  {order.notes && (
                    <div className="mt-2 p-2 bg-[#ffefb3]/60 border border-[#f0de99] rounded-xl text-[11px] text-[#013e37]">
                      <strong>Note:</strong> {order.notes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="p-3.5 bg-[#faf9f5] border-t border-[#e8e5dc] space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold text-[#013e37]">
                    <span>Total Amount</span>
                    <span className="text-sm font-black">
                      {currency}{order.totalAmount}
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {isPending && (
                      <div className="space-y-1.5">
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'preparing')}
                          className="w-full py-2 px-3 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          title="Authorize received payment and send order to kitchen"
                        >
                          <CreditCard size={14} />
                          <span>Confirm Payment & Start Prep</span>
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Cancel unpaid order #${order.orderNumber}?`)) {
                              handleUpdateStatus(order.id, 'cancelled');
                            }
                          }}
                          className="w-full py-1 text-[11px] font-medium text-[#013e37]/50 hover:text-rose-600 transition cursor-pointer text-center"
                        >
                          Cancel Unpaid Order
                        </button>
                      </div>
                    )}

                    {isPreparing && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'ready', false)}
                          className="py-2 px-2 bg-white hover:bg-[#ffefb3] text-[#013e37] border border-[#e8e5dc] text-xs font-bold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Bell size={13} />
                          <span>Mark Ready</span>
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'ready', true, order)}
                          className="py-2 px-2 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] text-xs font-bold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                          title="Marks ready and opens WhatsApp immediately"
                        >
                          <MessageCircle size={13} />
                          <span>Ready & Ping</span>
                        </button>
                      </div>
                    )}

                    {isReady && (
                      <div className="space-y-1.5">
                        <button
                          onClick={() => triggerWhatsAppMessage(order)}
                          className="w-full py-2 px-3 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <MessageCircle size={14} />
                          <span>WhatsApp: Ready for Pickup</span>
                          <ExternalLink size={11} className="opacity-70" />
                        </button>

                        <button
                          onClick={() => handleUpdateStatus(order.id, 'completed')}
                          className="w-full py-1.5 px-3 bg-white hover:bg-[#ffefb3]/60 text-[#013e37] border border-[#e8e5dc] text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Check size={13} />
                          <span>Mark as Collected</span>
                        </button>
                      </div>
                    )}

                    {isCompleted && (
                      <div className="flex items-center justify-between text-xs text-[#013e37]/60 pt-0.5">
                        <span className="flex items-center gap-1 font-medium">
                          <CheckCircle2 size={13} className="text-[#013e37]" /> Collected
                        </span>
                        <button
                          onClick={() => triggerWhatsAppMessage(order)}
                          className="text-[11px] text-[#013e37] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <MessageCircle size={11} /> Re-send message
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
