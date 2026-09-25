import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import Container from './Container';
import PageTransition from '../PageTransition';

const STEPS = [
  { label: 'Cart', to: '/cart' },
  { label: 'Checkout', to: '/checkout' },
  { label: 'Done', to: null }
];

/** Minimal chrome: logo, step indicator, and a reassurance line. No nav, no footer links. */
export default function CheckoutLayout() {
  const { pathname } = useLocation();
  const activeIndex = pathname.startsWith('/order-confirmed') ? 2 : 1;

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="border-b border-line-08 bg-paper">
        <Container className="flex items-center justify-between gap-6 py-4">
          <Link to="/" className="shrink-0">
            <img src="/assets/spoonup-logo.png" alt="SpoonUp" className="h-[42px] w-auto object-contain" />
          </Link>

          <ol className="hidden sm:flex items-center gap-2 list-none m-0 p-0">
            {STEPS.map((step, i) => (
              <li key={step.label} className="flex items-center gap-2">
                {i > 0 && <span className="text-ink-45 text-[11px]">·</span>}
                {step.to && i < activeIndex ? (
                  <Link to={step.to} className="text-[12.5px] text-ink-55 hover:text-ink">
                    {step.label}
                  </Link>
                ) : (
                  <span
                    className={`text-[12.5px] ${i === activeIndex ? 'font-medium text-ink' : 'text-ink-45'}`}
                  >
                    {step.label}
                  </span>
                )}
              </li>
            ))}
          </ol>

          <span className="text-[12px] text-ink-55 whitespace-nowrap">🔒 Secure checkout</span>
        </Container>
      </header>

      <main className="flex-1">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      <footer className="border-t border-line-08 py-6">
        <Container className="flex flex-wrap gap-x-5 gap-y-2 justify-center">
          {[
            ['Terms & conditions', '/legal/terms'],
            ['Privacy policy', '/legal/privacy'],
            ['Returns & refunds', '/legal/returns'],
            ['Wallet & subscription terms', '/legal/wallet']
          ].map(([label, to]) => (
            <Link key={label} to={to} className="text-[11.5px] text-ink-50 hover:text-ink">
              {label}
            </Link>
          ))}
        </Container>
      </footer>
    </div>
  );
}
