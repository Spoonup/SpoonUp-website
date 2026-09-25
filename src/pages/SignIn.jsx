import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import Eyebrow from '../components/ui/Eyebrow';
import Field from '../components/ui/Field';
import { useUser } from '../lib/useUser';

/** Accepts only a single-slash, same-origin path. Anything else falls back. */
function safeNext(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/account';
  return raw;
}

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Honour ?next= so a guarded route sends people back where they were headed.
  // Only same-site paths: a bare "//evil.com" or "https://evil.com" would
  // otherwise turn this page into an open redirect.
  const next = safeNext(params.get('next'));
  const { login, signup } = useUser();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
      } else {
        await signup({
          username: username.trim(),
          password,
          email: email.trim(),
          phone: `+91${phone.replace(/\D/g, '')}`
        });
      }
      navigate(next);
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-88px)] grid lg:grid-cols-2">
      <div className="relative hidden lg:block">
        <img src="/assets/generated/eat-now.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-ink/55" />
        <div className="relative h-full flex items-end p-12">
          <blockquote className="m-0 max-w-[420px]">
            <p className="font-display text-[30px] leading-[1.25] text-paper m-0">
              “The only breakfast I have not got bored of.”
            </p>
            <footer className="text-[12.5px] text-paper/70 mt-4">Aarav P. · Koramangala</footer>
          </blockquote>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 sm:px-10 py-14">
        <div className="w-full max-w-[380px]">
          <Eyebrow>Welcome back</Eyebrow>
          <h1 className="font-display text-[34px] leading-[1.15] text-ink mt-4 mb-0">
            Sign in to your
            <br />
            SpoonUp account
          </h1>
          <p className="text-[13.5px] leading-[1.6] text-ink-65 mt-3 mb-8">
            Track live orders, manage your plans and wallet, and reorder favourites. One account
            across web and app.
          </p>

          {/* TODO: Handle core functionality later — Google OAuth is not wired. */}
          <button
            type="button"
            disabled
            title="Not wired yet"
            className="w-full bg-ink/40 text-paper rounded-md py-3 text-[13.5px] font-medium cursor-not-allowed flex items-center justify-center gap-2.5"
          >
            <span className="bg-paper text-ink rounded-full w-[18px] h-[18px] grid place-items-center text-[11px] font-bold">
              G
            </span>
            Continue with Google · soon
          </button>

          <div className="flex items-center gap-3 my-6">
            <span className="flex-1 h-px bg-line-12" />
            <span className="text-[11.5px] text-ink-45">or use your account</span>
            <span className="flex-1 h-px bg-line-12" />
          </div>

          <div className="flex gap-2 mb-4">
            {[
              ['login', 'Sign in'],
              ['signup', 'Create account']
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setError('');
                }}
                className={`flex-1 rounded-pill py-2 text-[12.5px] font-medium cursor-pointer pressable ${
                  mode === id ? 'bg-ink text-paper' : 'bg-transparent text-ink border border-line-14'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <Field
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="yourname"
              autoComplete="username"
            />

            {mode === 'signup' && (
              <>
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <Field label="Mobile number" hint="Delivery contact only — we don't send a verification code.">
                  <div className="flex">
                    <span className="inline-flex items-center px-3 bg-cream border border-r-0 border-line-14 rounded-l-md text-[13px] text-ink-65">
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile number"
                      className="flex-1 bg-white border border-line-14 rounded-r-md px-3.5 py-2.5 text-[13.5px] focus:outline-none focus:border-olive"
                    />
                  </div>
                </Field>
              </>
            )}

            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            />

            {error && (
              <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 m-0">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-olive text-paper rounded-md py-3 text-[13.5px] font-medium hover:brightness-110 cursor-pointer pressable disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="grid grid-cols-2 gap-3 mt-4">
            {['Facebook', 'Apple'].map((p) => (
              <button
                key={p}
                type="button"
                disabled
                className="border border-line-12 rounded-md py-2.5 text-[12.5px] text-ink-45 cursor-not-allowed"
              >
                {p} · soon
              </button>
            ))}
          </div>

          <p className="text-[12px] leading-[1.6] text-ink-55 mt-6 mb-0">
            New here? Creating an account takes a moment. Have a referral code? Add it after — you
            both get ₹150 in wallet credit.
          </p>
          <p className="text-[11px] leading-[1.6] text-ink-45 mt-3 mb-0">
            By continuing you agree to our{' '}
            <Link to="/legal/terms" className="underline">terms</Link> and{' '}
            <Link to="/legal/privacy" className="underline">privacy policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
