import React, { useState } from 'react';
import {
  Truck,
  Search,
  RotateCw,
  Check,
  Package,
  XCircle,
  Undo2,
  WifiOff
} from 'lucide-react';
import { useAdminOrders } from '../hooks/useAdminOrders';

export default function AdminDeliveries({ adminPin, settings }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('pending');
  const [trackingDrafts, setTrackingDrafts] = useState({});
  const currency = settings?.currencySymbol || '₹';

  const { orders: allOrders, stats, isRefreshing, connectionError, refresh, updateStatus } = useAdminOrders(adminPin);
  const orders = allOrders.filter(o => o.fulfillmentType === 'delivery');

  const updateOrder = async (orderId, status, trackingLink) => {
    try {
      await updateStatus(orderId, status, { trackingLink });
    } catch (err) {
      alert(err.message);
    }
  };

  const filtered = orders.filter((order) => {
    const matchesSearch =
      String(order.orderNumber).includes(searchQuery) ||
      (order.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (order.customerPhone || '').includes(searchQuery);
    if (!matchesSearch) return false;
    if (activeTab === 'all') return true;
    return order.status === activeTab;
  });

  const formatAddress = (addr) => {
    if (!addr) return 'No address';
    return [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-[#E4E2D9]">
          <span className="text-xs font-semibold text-[#1B2A18]/70">To ship</span>
          <p className="text-2xl font-black text-[#1B2A18] mt-1">{stats?.deliveryPendingCount || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-[#E4E2D9]">
          <span className="text-xs font-semibold text-[#1B2A18]/70">Shipped</span>
          <p className="text-2xl font-black text-[#1B2A18] mt-1">{stats?.deliveryShippedCount || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-[#E4E2D9]">
          <span className="text-xs font-semibold text-[#1B2A18]/70">Delivery orders</span>
          <p className="text-2xl font-black text-[#1B2A18] mt-1">{stats?.deliveryCount || 0}</p>
        </div>
      </div>

      {connectionError && (
        <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-semibold">
          <WifiOff size={14} className="shrink-0" />
          <span>{connectionError}</span>
        </div>
      )}

      <div className="bg-white p-3.5 rounded-2xl border border-[#E4E2D9] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#1B2A18]/40" size={15} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search delivery orders..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#F4F1E7] border border-[#E4E2D9] rounded-xl text-xs sm:text-sm text-[#1B2A18] focus:outline-hidden focus:border-[#1B2A18]"
          />
        </div>
        <button
          onClick={() => refresh(true)}
          className="p-2 bg-white hover:bg-[#D8E2C4]/60 text-[#1B2A18] rounded-xl border border-[#E4E2D9] cursor-pointer"
        >
          <RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {['pending', 'shipped', 'delivered', 'rejected', 'refunded', 'all'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize cursor-pointer border ${
              activeTab === tab
                ? 'bg-[#1B2A18] text-[#FCFBF7] border-[#1B2A18]'
                : 'bg-white text-[#1B2A18] border-[#E4E2D9]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-[#E4E2D9]">
          <Truck className="w-10 h-10 text-[#1B2A18]/30 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-[#1B2A18]">No delivery orders here</h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((order) => (
            <div key={order.id} className="bg-white rounded-2xl border border-[#E4E2D9] overflow-hidden">
              <div className="p-3.5 border-b border-[#E4E2D9] flex justify-between gap-2">
                <div>
                  <p className="text-xl font-black text-[#1B2A18]">#{order.orderNumber}</p>
                  <p className="text-xs font-bold text-[#1B2A18]">{order.customerName}</p>
                  <p className="text-[11px] font-mono text-[#1B2A18]/60">{order.customerPhone}</p>
                </div>
                <span className="h-fit px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#D8E2C4] text-[#1B2A18] capitalize">
                  {order.status}
                </span>
              </div>
              <div className="p-3.5 text-xs space-y-1.5">
                {(order.items || []).map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{item.quantity}x {item.name}</span>
                    <span>{currency}{item.subtotal || item.price * item.quantity}</span>
                  </div>
                ))}
                <p className="pt-2 text-[#1B2A18]/80">
                  <strong>Address:</strong> {formatAddress(order.deliveryAddress)}
                  {order.deliveryAddress?.landmark ? ` (${order.deliveryAddress.landmark})` : ''}
                </p>
                {order.trackingLink && (
                  <a href={order.trackingLink} target="_blank" rel="noreferrer" className="text-[#1B2A18] underline">
                    Tracking link
                  </a>
                )}
                <p className="font-black pt-1">Total {currency}{order.totalAmount}</p>
              </div>
              <div className="p-3.5 bg-[#F4F1E7] border-t border-[#E4E2D9] space-y-2">
                {order.status === 'pending' && (
                  <>
                    <input
                      placeholder="Tracking URL (optional)"
                      value={trackingDrafts[order.id] || ''}
                      onChange={(e) => setTrackingDrafts((prev) => ({ ...prev, [order.id]: e.target.value }))}
                      className="w-full px-3 py-1.5 bg-white border border-[#E4E2D9] rounded-xl text-xs"
                    />
                    <button
                      onClick={() => updateOrder(order.id, 'shipped', trackingDrafts[order.id] || '')}
                      className="w-full py-2 bg-[#1B2A18] text-[#FCFBF7] text-xs font-bold rounded-xl cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Package size={13} /> Mark shipped
                    </button>
                  </>
                )}
                {order.status === 'shipped' && (
                  <button
                    onClick={() => updateOrder(order.id, 'delivered', order.trackingLink)}
                    className="w-full py-2 bg-[#1B2A18] text-[#FCFBF7] text-xs font-bold rounded-xl cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Check size={13} /> Mark delivered
                  </button>
                )}
                {(order.status === 'pending' || order.status === 'shipped') && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateOrder(order.id, 'rejected')}
                      className="py-1.5 text-[11px] font-semibold text-rose-700 border border-rose-200 rounded-xl cursor-pointer flex items-center justify-center gap-1"
                    >
                      <XCircle size={12} /> Rejected
                    </button>
                    <button
                      onClick={() => updateOrder(order.id, 'refunded')}
                      className="py-1.5 text-[11px] font-semibold text-[#1B2A18] border border-[#E4E2D9] rounded-xl cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Undo2 size={12} /> Refunded
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
