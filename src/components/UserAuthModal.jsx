import React, { useState } from 'react';
import { User, X, AlertCircle } from 'lucide-react';

export default function UserAuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = mode === 'signup'
        ? { username: username.trim(), password, email: email.trim(), phone: phone.trim() }
        : { username: username.trim(), password };

      const res = await fetch(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      localStorage.setItem('user_session', data.token);
      setUsername('');
      setPassword('');
      setEmail('');
      setPhone('');
      onAuthSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-[#e8e5dc] overflow-hidden">
        <div className="relative bg-[#013e37] p-6 text-[#ffefb3] text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[#ffefb3]/70 hover:text-[#ffefb3] p-1 rounded-full cursor-pointer"
          >
            <X size={18} />
          </button>
          <div className="w-10 h-10 bg-[#ffefb3] text-[#013e37] rounded-xl flex items-center justify-center mx-auto mb-2.5">
            <User size={18} />
          </div>
          <h3 className="text-lg font-bold tracking-tight">
            {mode === 'signup' ? 'Create account' : 'Welcome back'}
          </h3>
          <p className="text-[#ffefb3]/80 text-xs mt-0.5">
            {mode === 'signup' ? 'Save orders to your profile' : 'Track orders linked to your profile'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#013e37] mb-1">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-sm text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#013e37] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : 1}
              className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-sm text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
            />
          </div>

          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-bold text-[#013e37] mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-sm text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#013e37] mb-1">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="+91 10-digit number"
                  className="w-full px-3 py-2 bg-[#faf9f5] border border-[#e8e5dc] rounded-xl text-sm text-[#013e37] focus:outline-hidden focus:border-[#013e37]"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#013e37] hover:bg-[#06554c] disabled:opacity-50 text-[#ffefb3] font-bold text-xs rounded-xl cursor-pointer"
          >
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}
            className="w-full text-[11px] font-semibold text-[#013e37]/70 hover:text-[#013e37] cursor-pointer"
          >
            {mode === 'signup' ? 'Already have an account? Log in' : 'New here? Sign up'}
          </button>
        </form>
      </div>
    </div>
  );
}
