import React, { useState, useMemo } from 'react';
import { 
  Search, 
  ShoppingBag, 
  Plus, 
  Minus, 
  Trash2, 
  X, 
  ChevronRight, 
  Sparkles,
  Phone,
  User,
  Clock,
  CheckCircle2,
  FileText
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function CustomerMenu({ 
  products, 
  settings, 
  cart, 
  setCart, 
  onOrderPlaced,
  onOpenMyOrders
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const currency = settings.currencySymbol || '₹';

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category || 'General'));
    return ['All', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  const addToCart = (product) => {
    if (!product.isAvailable) return;
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId, delta) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      }).filter(Boolean);
    });
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setErrorMessage('Please enter your full name');
      return;
    }
    const cleanNumber = customerPhone.replace(/\D/g, '');
    if (cleanNumber.length < 8) {
      setErrorMessage('Please enter a valid phone/WhatsApp number');
      return;
    }
    if (cart.length === 0) {
      setErrorMessage('Your cart is empty');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const fullPhone = `${countryCode}${cleanNumber}`;
      const payload = {
        customerName: customerName.trim(),
        customerPhone: fullPhone,
        items: cart.map(item => ({ id: item.id, quantity: item.quantity })),
        notes: notes.trim()
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to place order');
      }

      try {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#013e37', '#ffefb3', '#f0de99']
        });
      } catch (err) {}

      const storedOrders = JSON.parse(localStorage.getItem('my_orders') || '[]');
      storedOrders.unshift(data);
      localStorage.setItem('my_orders', JSON.stringify(storedOrders));

      // Persist unguessable secret token for this order
      const tokenMap = JSON.parse(localStorage.getItem('order_tokens') || '{}');
      if (data.accessToken) {
        tokenMap[data.id] = data.accessToken;
        tokenMap[String(data.orderNumber)] = data.accessToken;
      }
      localStorage.setItem('order_tokens', JSON.stringify(tokenMap));

      setCart([]);
      setIsCartOpen(false);
      onOrderPlaced(data);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pb-28">
      {/* SpoonUp Hero Section */}
      <div className="bg-[#ffefb3] rounded-3xl p-6 sm:p-8 text-[#013e37] border border-[#f0de99] shadow-2xs mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Logo */}
          <img
            src="/SpoonUp_Official_Logo_Transparent.png"
            alt="SpoonUp — Good Food, Higher Days"
            className="h-20 sm:h-24 w-auto object-contain flex-shrink-0"
          />
          {/* Text */}
          <div className="flex-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 text-xs font-semibold uppercase tracking-wider text-[#013e37] mb-3 border border-[#013e37]/10">
              <Sparkles size={13} className="text-[#013e37]" />
              <span>Real Food. Real Nutrition. Real Goodness.</span>
            </div>
            <p className="mt-1 text-sm sm:text-base text-[#013e37]/80 leading-relaxed">
              Order online, skip the wait. We'll ping you on <strong className="underline decoration-[#013e37]/30">WhatsApp</strong> when your order is ready for pickup!
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-[#013e37] bg-white/60 px-3 py-1.5 rounded-xl border border-[#013e37]/10">
              <Clock size={14} />
              <span>Pickup: <strong className="font-bold">{settings.counterName || "Main Shop"}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Minimal Sticky Search & Filters */}
      <div className="sticky top-16 z-20 bg-[#faf9f5]/95 backdrop-blur-md py-3 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#013e37]/50" size={17} />
          <input
            type="text"
            placeholder="Search food, drinks, desserts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#e8e5dc] rounded-2xl text-sm text-[#013e37] placeholder-[#013e37]/40 focus:outline-hidden focus:border-[#013e37] focus:ring-1 focus:ring-[#013e37] transition"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#013e37]/40 hover:text-[#013e37]"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Minimal Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer border ${
                  isActive 
                    ? 'bg-[#013e37] text-[#ffefb3] border-[#013e37]' 
                    : 'bg-white hover:bg-[#ffefb3]/60 text-[#013e37] border-[#e8e5dc]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Product Catalog Grid */}
      <div className="pt-4">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#e8e5dc] p-8">
            <ShoppingBag className="w-10 h-10 text-[#013e37]/30 mx-auto mb-2" />
            <h3 className="text-base font-bold text-[#013e37]">No items found</h3>
            <p className="text-xs text-[#013e37]/60 mt-1">Try another search keyword or category filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredProducts.map((product) => {
              const inCartItem = cart.find(c => c.id === product.id);
              const isAvailable = product.isAvailable;

              return (
                <div
                  key={product.id}
                  className={`bg-white rounded-2xl border border-[#e8e5dc] transition-all flex flex-col justify-between overflow-hidden hover:border-[#013e37]/30 ${
                    !isAvailable ? 'opacity-60 bg-[#f9f8f4]' : ''
                  }`}
                >
                  <div className="flex p-3.5 gap-3.5">
                    {/* Item Image */}
                    <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-[#faf9f5] border border-[#e8e5dc]">
                      <img
                        src={product.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80'}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80';
                        }}
                      />
                      {!isAvailable && (
                        <div className="absolute inset-0 bg-[#013e37]/80 backdrop-blur-2xs flex items-center justify-center p-1 text-center">
                          <span className="text-[10px] font-bold uppercase text-[#ffefb3] bg-[#013e37] px-2 py-0.5 rounded">
                            Sold Out
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <h3 className="font-bold text-[#013e37] text-base leading-snug truncate">
                            {product.name}
                          </h3>
                        </div>
                        <span className="inline-block mt-1 text-[10px] font-semibold text-[#013e37] bg-[#ffefb3] px-2 py-0.5 rounded-full border border-[#f0de99]">
                          {product.category}
                        </span>
                        <p className="text-xs text-[#013e37]/70 mt-1 line-clamp-2 leading-relaxed">
                          {product.description || 'Freshly prepared for you.'}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-base font-black text-[#013e37]">
                          {currency}{product.price}
                        </span>

                        {/* Add to Cart / Qty Stepper */}
                        {isAvailable ? (
                          inCartItem ? (
                            <div className="flex items-center bg-[#013e37] text-[#ffefb3] rounded-full overflow-hidden shadow-2xs">
                              <button
                                onClick={() => updateQuantity(product.id, -1)}
                                className="p-1.5 px-2 hover:bg-[#06554c] transition cursor-pointer"
                              >
                                <Minus size={13} />
                              </button>
                              <span className="px-2 text-xs font-bold font-mono">
                                {inCartItem.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(product.id, 1)}
                                className="p-1.5 px-2 hover:bg-[#06554c] transition cursor-pointer"
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => addToCart(product)}
                              className="px-3.5 py-1.5 bg-[#013e37] hover:bg-[#06554c] text-[#ffefb3] font-semibold text-xs rounded-full transition flex items-center gap-1 shadow-2xs cursor-pointer"
                            >
                              <Plus size={13} />
                              <span>Add</span>
                            </button>
                          )
                        ) : (
                          <span className="text-xs font-medium text-[#013e37]/40 bg-[#f0ede4] px-2.5 py-1 rounded-lg">
                            Unavailable
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Minimal Floating Bottom Cart Bar */}
      {totalItemsCount > 0 && (
        <div className="fixed bottom-5 left-4 right-4 max-w-md mx-auto z-40 animate-in slide-in-from-bottom-4 duration-200">
          <div 
            onClick={() => setIsCartOpen(true)}
            className="bg-[#013e37] text-[#ffefb3] p-3.5 px-5 rounded-2xl shadow-xl flex items-center justify-between cursor-pointer hover:bg-[#06554c] transition border border-[#013e37]"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#ffefb3] text-[#013e37] rounded-xl flex items-center justify-center font-bold text-xs">
                {totalItemsCount}
              </div>
              <div>
                <p className="text-[11px] text-[#ffefb3]/70 uppercase tracking-wider font-medium">Cart Total</p>
                <p className="text-base font-black text-[#ffefb3]">{currency}{totalCartAmount}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-[#ffefb3] bg-white/10 px-3 py-1.5 rounded-xl">
              <span>View Cart & Checkout</span>
              <ChevronRight size={15} />
            </div>
          </div>
        </div>
      )}

      {/* Minimal Slide-in Checkout Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-2xs">
          <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-[#e8e5dc] flex items-center justify-between bg-[#faf9f5]">
              <div className="flex items-center gap-2">
                <ShoppingBag className="text-[#013e37]" size={18} />
                <h3 className="font-bold text-[#013e37] text-base">Your Cart</h3>
                <span className="text-xs font-bold bg-[#ffefb3] text-[#013e37] px-2 py-0.5 rounded-full border border-[#f0de99]">
                  {totalItemsCount} items
                </span>
              </div>
              <button 
                onClick={() => setIsCartOpen(false)}
                className="p-1 text-[#013e37]/60 hover:text-[#013e37] rounded-lg hover:bg-[#ffefb3]/50 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-[#f0ede4]">
              {cart.map((item) => (
                <div key={item.id} className="pt-3 first:pt-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="w-12 h-12 rounded-xl object-cover bg-[#faf9f5] shrink-0 border border-[#e8e5dc]"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-[#013e37] text-sm truncate">{item.name}</p>
                      <p className="text-xs text-[#013e37]/70 font-medium">
                        {currency}{item.price} each
                      </p>
                      <p className="text-xs font-bold text-[#013e37] mt-0.5">
                        {currency}{item.price * item.quantity}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center bg-[#faf9f5] rounded-full border border-[#e8e5dc] overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="p-1 px-2 hover:bg-[#ffefb3] text-[#013e37] transition cursor-pointer"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="px-1 text-xs font-bold font-mono text-[#013e37]">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="p-1 px-2 hover:bg-[#ffefb3] text-[#013e37] transition cursor-pointer"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-[#013e37]/40 hover:text-rose-600 p-1 transition cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Checkout Form */}
            <div className="p-4 bg-[#faf9f5] border-t border-[#e8e5dc] space-y-3.5">
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700">
                  ⚠️ {errorMessage}
                </div>
              )}

              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-bold text-[#013e37] mb-1">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Priya Sharma"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#e8e5dc] rounded-xl text-sm text-[#013e37] focus:border-[#013e37] focus:ring-1 focus:ring-[#013e37] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#013e37] mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Phone size={13} className="text-[#013e37]" />
                      WhatsApp Phone Number *
                    </span>
                    <span className="text-[10px] text-[#013e37] font-semibold bg-[#ffefb3] px-1.5 py-0.5 rounded border border-[#f0de99]">
                      For pickup alert
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="px-2.5 py-2 bg-white border border-[#e8e5dc] rounded-xl text-xs font-semibold text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                    >
                      <option value="+91">🇮🇳 +91</option>
                      <option value="+1">🇺🇸 +1</option>
                      <option value="+44">🇬🇧 +44</option>
                      <option value="+971">🇦🇪 +971</option>
                      <option value="+65">🇸🇬 +65</option>
                    </select>
                    <input
                      type="tel"
                      required
                      placeholder="10-digit number"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white border border-[#e8e5dc] rounded-xl text-sm font-mono text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                    />
                  </div>
                  <p className="text-[11px] text-[#013e37]/70 mt-1">
                    📲 We will WhatsApp you the moment your order is ready at the counter.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#013e37] mb-1">
                    Special Request (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Less sugar, extra napkins..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#e8e5dc] rounded-xl text-xs text-[#013e37] focus:border-[#013e37] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Price Summary */}
              <div className="pt-2 border-t border-[#e8e5dc] space-y-1 text-xs">
                <div className="flex justify-between text-[#013e37]/70">
                  <span>Subtotal</span>
                  <span>{currency}{totalCartAmount}</span>
                </div>
                <div className="flex justify-between text-base font-black text-[#013e37] pt-1">
                  <span>Total Due</span>
                  <span>{currency}{totalCartAmount}</span>
                </div>
                <p className="text-[11px] text-[#013e37]/60 text-center pt-0.5">
                  Pay at counter (Cash / UPI / Card accepted)
                </p>
              </div>

              {/* Place Order Button */}
              <button
                type="button"
                onClick={handleCheckout}
                disabled={isSubmitting || cart.length === 0}
                className="w-full py-3 px-4 bg-[#013e37] hover:bg-[#06554c] disabled:opacity-50 text-[#ffefb3] font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-[#ffefb3]/30 border-t-[#ffefb3] rounded-full animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Confirm Order ({currency}{totalCartAmount})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
