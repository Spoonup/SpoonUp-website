import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import TypeTag from '../components/ui/TypeTag';
import Container from '../components/layout/Container';
import Cookie from '../components/ui/Cookie';

const CATEGORIES = [
  {
    type: 'kitchen',
    tag: 'NOW · 30–45 MIN',
    title: 'Eat Now',
    to: '/shop',
    copy: 'Tikkis, smoothies and puddings from our kitchen, at your door in about 35 minutes.',
    cta: 'Order now'
  },
  {
    type: 'plan',
    tag: 'PLAN · UP TO 18% OFF',
    title: 'Subscribe',
    to: '/subscribe',
    copy: 'Pick a product, a rhythm and a duration. Breakfast, handled.',
    cta: 'Build a plan'
  },
  {
    type: 'pantry',
    tag: 'SHIPS · 3–5 DAYS',
    title: 'Pantry',
    to: '/shop?type=pantry',
    copy: 'Kashmiri dry fruits, muesli and modak, sourced for each order.',
    cta: 'Shop pantry'
  }
];

export default function NotFound() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const search = (e) => {
    e.preventDefault();
    // The shop has no text search yet; send the term through so it survives.
    navigate(query.trim() ? `/shop?q=${encodeURIComponent(query.trim())}` : '/shop');
  };

  return (
    <>
      {/* Hero — design: #F4F1E7, padding 64px 40px 60px, centred, 22px gap */}
      <section className="bg-cream overflow-hidden">
        <Container className="pt-16 pb-[60px] flex flex-col items-center text-center gap-[22px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-almond m-0">
            Error 404 · Page not found
          </p>

          <div className="flex items-center gap-[18px] max-w-full">
            <span
              className="font-display text-ink select-none text-[clamp(96px,18vw,230px)]"
              style={{ lineHeight: 0.85, letterSpacing: '-0.02em' }}
            >
              4
            </span>
            {/* Scales with the 4s so the trio stays proportional on small screens. */}
            <Cookie scale={1} className="hidden lg:block" />
            <Cookie scale={0.62} className="hidden sm:block lg:hidden" />
            <Cookie scale={0.42} className="sm:hidden" />
            <span
              className="font-display text-ink select-none text-[clamp(96px,18vw,230px)]"
              style={{ lineHeight: 0.85, letterSpacing: '-0.02em' }}
            >
              4
            </span>
          </div>

          <h1 className="font-display text-[clamp(32px,5vw,56px)] leading-[1.05] text-ink mt-2.5 mb-0">
            Someone <em className="italic">ate</em> this page.
          </h1>

          <p
            className="text-[16px] leading-[1.65] m-0 max-w-[560px]"
            style={{ color: 'rgba(27,42,24,.68)' }}
          >
            We checked the fridge, the pantry and every delivery bag. All we found was an empty jar
            and a spoon. The link may be old, or the page has moved.
          </p>

          <form onSubmit={search} className="flex gap-2.5 w-full max-w-[560px] mt-1.5">
            <label htmlFor="notfound-search" className="sr-only">
              Search products
            </label>
            <input
              id="notfound-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search puddings, smoothies, dry fruits…"
              className="flex-1 min-w-0 bg-white border border-line-16 rounded-pill px-5 py-[14px] text-[14px] text-ink placeholder:text-ink-45 text-left focus:outline-none focus:border-olive transition"
            />
            <button
              type="submit"
              className="bg-ink text-paper rounded-pill px-[22px] py-[14px] text-[14px] font-medium whitespace-nowrap cursor-pointer pressable hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap gap-3 justify-center mt-1">
            <Button to="/" variant="primary" size="lg">
              Back to home
            </Button>
            <Button to="/account" variant="outline" size="lg">
              Track an order
            </Button>
          </div>
        </Container>
      </section>

      <Container className="py-[44px]">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-[22px]">
          <h2 className="font-display text-[clamp(26px,3vw,32px)] text-ink m-0">Still fresh, still here</h2>
          <p className="text-[13px] text-ink-55 m-0">Pick up where you meant to go</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3 stagger">
          {CATEGORIES.map((c) => (
            <Link
              key={c.title}
              to={c.to}
              className="bg-white rounded-lg border border-line-10 p-5 lift flex flex-col gap-2"
            >
              <TypeTag type={c.type}>{c.tag}</TypeTag>
              <h3 className="font-display text-[23px] leading-[1.2] text-ink mt-1 mb-0">{c.title}</h3>
              <p className="text-[13.5px] leading-[1.6] text-ink-65 m-0">{c.copy}</p>
              <span className="text-[13px] text-olive mt-auto pt-2">{c.cta} →</span>
            </Link>
          ))}
        </div>
      </Container>

      <section className="bg-ink">
        <Container className="py-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium text-paper m-0">Looking for something specific?</p>
            <p className="text-[13px] text-paper/70 m-0 mt-1">
              Tell us what link you followed and we&apos;ll point you to the right place.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="https://wa.me/919116508320" variant="sage" size="md">
              Chat on WhatsApp
            </Button>
            <Button href="mailto:support@spoonupfoods.com" variant="outlineOnDark" size="md">
              support@spoonupfoods.com
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
