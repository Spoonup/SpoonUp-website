import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_SESSION_KEY, clearAdminSession } from '../lib/adminSession';

/**
 * Staff sign-in, built to the admin handoff's "Admin login" screen: 1fr/1fr split,
 * form on paper at 36/56, ink photo panel at 48/56.
 *
 * Two things in that screen have no server behind them. `POST /api/admin/login`
 * takes a username (3-32 of [A-Za-z0-9_]) — an email cannot be stored as the
 * credential — and it issues the session immediately, so there is no second OTP
 * step and no variable session length. The field is labelled for what the server
 * accepts and the device checkbox is shown but disabled rather than promising
 * 30 days it cannot honour.
 */

function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

const FIELD =
  'w-full bg-white rounded-md px-[14px] py-[13px] text-[14.5px] text-ink placeholder:text-ink-45 border border-line-16 focus:outline-none focus:border-olive focus:shadow-[0_0_0_3px_rgba(74,93,46,.12)] transition';

export default function AdminLogin({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed.');

      clearAdminSession();
      localStorage.setItem(ADMIN_SESSION_KEY, data.token);
      setPassword('');
      onLoginSuccess(data.token, data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper grid grid-cols-1 lg:grid-cols-2">
      {/* ---------------- form half ---------------- */}
      <div className="flex flex-col justify-between gap-10 px-6 sm:px-10 lg:px-14 py-9">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center pressable" aria-label="SpoonUp home">
            <img src="/assets/spoonup-logo.png" alt="SpoonUp" className="h-[46px] w-auto object-contain" />
          </Link>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-almond border border-almond/35 rounded-tag px-2 py-1 leading-none">
            Admin
          </span>
        </div>

        <form onSubmit={handleSubmit} className="w-full max-w-[380px] flex flex-col gap-[22px] page-enter">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-almond m-0">Staff sign-in</p>
            <h1 className="font-display text-[clamp(34px,5vw,44px)] leading-[1.05] text-ink m-0">
              {greeting()}
              <br />
              Kitchen&apos;s waiting.
            </h1>
          </div>

          <label htmlFor="admin-username" className="flex flex-col gap-[7px] text-[12.5px] font-medium text-ink">
            Username
            <input
              id="admin-username"
              type="text"
              maxLength={32}
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              placeholder="spoonadmin"
              className={FIELD}
            />
          </label>

          <label htmlFor="admin-password" className="flex flex-col gap-[7px] text-[12.5px] font-medium text-ink">
            <span className="flex justify-between gap-3">
              Password
              <span className="font-normal text-ink-55">Forgot? Ask an owner to reset</span>
            </span>
            <input
              id="admin-password"
              type="password"
              maxLength={128}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="••••••••"
              className={FIELD}
            />
          </label>

          {/* Shown for parity with the handoff, disabled because session length is
              fixed at 12h server-side and signed into the token. */}
          <label
            className="flex items-center gap-[9px] text-[13px] text-ink-72 opacity-60 cursor-not-allowed"
            title="Not available yet — staff sessions currently last 12 hours."
          >
            <input type="checkbox" disabled className="w-4 h-4 m-0 accent-olive cursor-not-allowed" />
            Trust this device for 30 days
          </label>

          <div aria-live="polite" className="-my-2 min-h-[18px]">
            {error && <p className="text-[12.5px] leading-[1.5] text-almond m-0 animate-fade-in">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md py-[14px] text-[14.5px] font-semibold bg-ink text-paper hover:bg-olive disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive transition-colors"
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>

          <p className="text-[12.5px] leading-[1.55] text-ink-55 m-0">
            Sessions last 12 hours, then you sign in again. Customer accounts can&apos;t sign in here.
          </p>
        </form>

        <p className="text-[11.5px] text-ink-45 m-0">
          SpoonUp Foods · Internal tool · Sign-ins are logged
        </p>
      </div>

      {/* ---------------- photo half ---------------- */}
      <div className="relative hidden lg:flex flex-col justify-end overflow-hidden bg-ink px-14 py-12">
        <img
          src="/assets/products/pudding-jar.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg,rgba(27,42,24,0) 35%,rgba(27,42,24,.92) 88%)'
          }}
        />
        <div className="relative flex flex-col gap-2.5 max-w-[380px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sage m-0">
            SpoonUp Kitchen · Koramangala
          </p>
          <p className="font-display text-[40px] leading-[1.08] text-paper m-0">
            Good food,
            <br />
            <em className="italic">higher days.</em>
          </p>
        </div>
      </div>
    </div>
  );
}
