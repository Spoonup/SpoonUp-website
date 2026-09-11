import React, { useState } from 'react';
import { Lock, X, KeyRound, AlertCircle } from 'lucide-react';

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter your admin PIN');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('admin_session', data.token);
      localStorage.removeItem('admin_pin');
      setPin('');
      onLoginSuccess(data.token, data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-[#e8e5dc] overflow-hidden">
        <div className="relative bg-[#013e37] p-6 text-[#ffefb3] text-center">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-[#ffefb3]/70 hover:text-[#ffefb3] p-1 rounded-full transition cursor-pointer"
          >
            <X size={18} />
          </button>
          <div className="w-10 h-10 bg-[#ffefb3] text-[#013e37] rounded-xl flex items-center justify-center mx-auto mb-2.5 shadow-xs">
            <Lock size={18} />
          </div>
          <h3 className="text-lg font-bold tracking-tight">Staff Portal Access</h3>
          <p className="text-[#ffefb3]/80 text-xs mt-0.5">Counter administrators only</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#013e37] mb-2 text-center uppercase tracking-wider">
              Enter 4-Digit PIN
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#013e37]/40">
                <KeyRound size={16} />
              </div>
              <input
                type="password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="enter the pin"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-center text-sm tracking-widest font-mono font-bold text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
              />
            </div>
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#013e37] hover:bg-[#06554c] disabled:opacity-50 text-[#ffefb3] font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-[#ffefb3]/30 border-t-[#ffefb3] rounded-full animate-spin" />
              ) : (
                'Unlock Dashboard'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
