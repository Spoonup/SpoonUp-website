import React from 'react';
import { Link } from 'react-router-dom';
import Container from './Container';

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      { label: 'Eat Now', to: '/shop' },
      { label: 'Subscriptions', to: '/subscribe' },
      { label: 'Pantry', to: '/shop?type=pantry' }
    ]
  },
  {
    title: 'Company',
    links: [
      { label: 'Our story', to: '/our-story' },
      { label: 'Contact us', to: '/our-story' },
      { label: 'Careers', to: '/our-story' }
    ]
  },
  {
    title: 'Policies',
    links: [
      { label: 'Terms & conditions', to: '/legal/terms' },
      { label: 'Privacy policy', to: '/legal/privacy' },
      { label: 'Returns & refunds', to: '/legal/returns' },
      { label: 'Shipping policy', to: '/legal/shipping' },
      { label: 'Wallet & subscription terms', to: '/legal/wallet' }
    ]
  }
];

export default function SiteFooter() {
  return (
    <footer className="bg-paper border-t border-line-08 py-[34px]">
      <Container className="grid gap-8 md:grid-cols-[1.6fr_repeat(3,1fr)] items-start">
        {/* Brand sits centred in the row so it balances the taller link columns. */}
        <div className="md:self-center flex flex-col items-center text-center md:items-start md:text-left">
          <img
            src="/assets/spoonup-logo.png"
            alt="SpoonUp"
            className="h-[76px] lg:h-[88px] w-auto object-contain"
          />
          <p className="mt-4 font-display text-[22px] leading-[1.3] text-ink m-0">
            Good food, higher days.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-almond m-0 mb-3.5">
              {col.title}
            </h3>
            <ul className="list-none p-0 m-0 space-y-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="text-[12.5px] leading-[2] text-ink-65 hover:text-ink transition">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>

      <Container className="mt-8 pt-5 border-t border-line-08 flex flex-wrap gap-3 justify-between">
        <p className="text-[11.5px] text-ink-50 m-0">© {new Date().getFullYear()} SpoonUp Foods</p>
        <p className="text-[11.5px] text-ink-50 m-0">Bengaluru, India</p>
      </Container>
    </footer>
  );
}
