import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useCart } from '../../lib/useCart';
import { useUser } from '../../lib/useUser';
import Container from './Container';

const NAV = [
  { to: '/shop', label: 'Eat Now' },
  { to: '/subscribe', label: 'Subscribe' },
  { to: '/shop?type=pantry', label: 'Pantry' },
  { to: '/our-story', label: 'Our Story' }
];

/**
 * Shared web chrome. Logo is 46px (52px on Home per the spec — passed via `tall`).
 * Below `md` the nav collapses into a sheet and the location pill moves into it.
 */
export default function SiteHeader({ tall = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { count } = useCart();
  const { user } = useUser();

  return (
    <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur-sm border-b border-line-08">
      <Container className="flex items-center justify-between gap-6 py-4">
        <Link to="/" className="flex items-center shrink-0">
          <img
            src="/assets/spoonup-logo.png"
            alt="SpoonUp"
            className="w-auto object-contain"
            style={{ height: tall ? 52 : 46 }}
          />
        </Link>

        <nav className="hidden md:flex items-center gap-7 mr-auto ml-2">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                `text-[13.5px] font-medium transition-colors duration-200 nav-underline ${
                  isActive ? 'text-olive' : 'text-ink hover:text-olive'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {user ? (
            <Link
              to="/account"
              title={`Signed in as ${user.username}`}
              className="hidden sm:flex items-center gap-2 bg-cream border border-line-10 rounded-pill pl-1.5 pr-4 py-1.5 text-[13px] font-medium text-ink hover:bg-tint-ink pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
            >
              <span className="w-[26px] h-[26px] rounded-full bg-olive text-paper grid place-items-center text-[10.5px] font-medium">
                {user.username.slice(0, 2).toUpperCase()}
              </span>
              <span className="max-w-[110px] truncate">{user.username}</span>
            </Link>
          ) : (
            <Link
              to="/signin"
              className="hidden sm:inline-flex items-center bg-cream border border-line-10 rounded-pill px-[18px] py-[10px] text-[13px] font-medium text-ink hover:bg-tint-ink pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
            >
              Sign in
            </Link>
          )}

          <Link
            to="/cart"
            aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
            className="inline-flex items-center gap-2 bg-ink text-paper rounded-pill px-[18px] py-[10px] text-[13px] font-medium hover:brightness-125 whitespace-nowrap pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L21 8H6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="20" r="1.4" fill="currentColor" />
              <circle cx="17.5" cy="20" r="1.4" fill="currentColor" />
            </svg>
            <span>Cart</span>
            <span
              key={count}
              className={`animate-pop tabular-nums min-w-[20px] text-center rounded-pill px-1.5 py-0.5 text-[11.5px] leading-none ${
                count > 0 ? 'bg-sage text-ink' : 'bg-paper/15 text-paper/70'
              }`}
            >
              {count}
            </span>
          </Link>

          <button
            type="button"
            className="md:hidden w-10 h-10 grid place-items-center rounded-pill border border-line-14 cursor-pointer pressable"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="text-[16px] leading-none">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </Container>

      {menuOpen && (
        <Container className="md:hidden border-t border-line-08 py-4 space-y-3 bg-paper">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="block text-[15px] font-medium text-ink py-1"
            >
              {item.label}
            </NavLink>
          ))}
          <Link
            to={user ? '/account' : '/signin'}
            onClick={() => setMenuOpen(false)}
            className="block text-[13.5px] text-olive pt-1"
          >
            {user ? `My account · ${user.username}` : 'Sign in'}
          </Link>
        </Container>
      )}
    </header>
  );
}
