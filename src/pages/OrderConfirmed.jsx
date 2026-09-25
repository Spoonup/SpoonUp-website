import React from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import Container from '../components/layout/Container';
import Button from '../components/ui/Button';
import { ORDER_TYPES } from '../lib/orderTypes';
import { rupees, getProduct } from '../data/catalogue';

const METHOD_LABEL = { upi: 'UPI', card: 'Card', netbanking: 'Netbanking' };

/** Next N delivery dates for a plan, generated from the start date. */
function nextDates(count = 5) {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + 1 + i * 2);
    return fmt.format(d);
  });
}

export default function OrderConfirmed() {
  const { state } = useLocation();

  // Reached directly without placing an order.
  if (!state?.id) return <Navigate to="/" replace />;

  const { id, total, method, kitchen = [], pantry = [], plans = [], slot } = state;

  const cards = [
    kitchen.length && {
      type: 'kitchen',
      header: 'Kitchen order',
      title: slot ? `Arriving ${slot.toLowerCase()}` : 'Arriving in ~40 minutes',
      body: (
        <>
          <p className="text-[13px] text-ink-65 m-0">
            {kitchen.map((r) => `${r.qty}× ${r.name}`).join(', ')}
          </p>
          <p className="text-[12.5px] leading-[1.6] text-ink-55 m-0 mt-2">
            Made fresh. We&apos;ll message you on WhatsApp when the rider leaves.
          </p>
        </>
      )
    },
    plans.length && {
      type: 'plan',
      header: 'Your plan',
      title: `First jar ${plans[0].startDate}`,
      body: (
        <>
          <p className="text-[13px] text-ink-65 m-0">
            {getProduct(plans[0].productId)?.name} · {plans[0].deliveries} deliveries
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {nextDates().map((d) => (
              <span
                key={d}
                className="bg-ink text-paper rounded-tag px-2 py-1 font-mono text-[10px] tracking-[0.06em]"
              >
                {d}
              </span>
            ))}
            <span className="text-[11px] text-ink-55 self-center">
              +{Math.max(0, plans[0].deliveries - 5)} more
            </span>
          </div>
          <p className="text-[12.5px] leading-[1.6] text-ink-55 m-0 mt-3">
            {rupees(plans[0].net)} is in your plan wallet. Skip or pause any day from My plans.
          </p>
        </>
      )
    },
    pantry.length && {
      type: 'pantry',
      header: 'Pantry shipment',
      title: 'Arrives in 3–5 days',
      body: (
        <>
          <p className="text-[13px] text-ink-65 m-0">
            {pantry.map((r) => `${r.qty}× ${r.name}`).join(', ')}
          </p>
          <p className="text-[12.5px] leading-[1.6] text-ink-55 m-0 mt-2">
            Sourced for your order. The courier tracking link comes by WhatsApp and email once it ships.
          </p>
        </>
      )
    }
  ].filter(Boolean);

  return (
    <>
      <Container className="py-[44px] text-center">
        <div className="w-14 h-14 rounded-full bg-olive text-paper grid place-items-center mx-auto text-[26px]">
          ✓
        </div>
        <h1 className="font-display text-[clamp(30px,4vw,42px)] leading-[1.1] text-ink mt-6 mb-0">
          Thank you. Your order is in.
        </h1>
        <p className="text-[13px] text-ink-65 mt-4 mb-0">
          Order <span className="font-mono">{id}</span> · {rupees(total)} paid with{' '}
          {METHOD_LABEL[method] || 'UPI'} · receipt sent to your email
        </p>
      </Container>

      <Container className="pb-[44px]">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const t = ORDER_TYPES[card.type];
            return (
              <section
                key={card.type}
                className="bg-white rounded-card border border-line-10 p-5"
                style={{ borderTop: `3px solid ${t.color}` }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.12em] m-0"
                  style={{ color: t.color }}
                >
                  {card.header}
                </p>
                <h2 className="text-[15px] font-medium text-ink mt-2 mb-3">{card.title}</h2>
                {card.body}
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3 justify-center mt-10">
          <Button to="/account" variant="primary" size="lg">
            Track this order
          </Button>
          {plans.length > 0 && (
            <Button to="/account/plans" variant="outline" size="lg">
              Manage my plan
            </Button>
          )}
          <Button to="/shop" variant="text">
            Continue shopping →
          </Button>
        </div>
      </Container>

      <section className="bg-ink">
        <Container className="py-10 flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-[15px] font-medium text-paper m-0">Tell a friend</p>
            <p className="text-[13px] leading-[1.6] text-paper/70 m-0 mt-1 max-w-[420px]">
              {/* TODO: Handle core functionality later — no referral service yet, so
                  there is no personal code to show and no credit to promise. */}
              Referral credit is on the way. For now, send them the shop.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              href="https://wa.me/?text=Try%20SpoonUp%20%E2%80%94%20https%3A%2F%2Fspoonupfoods.com"
              variant="sage"
              size="md"
            >
              Share on WhatsApp
            </Button>
          </div>
        </Container>
      </section>

      <Container className="pb-[34px] text-center">
        <Link to="/" className="text-[13px] text-ink-55 hover:text-ink">
          ← Back to home
        </Link>
      </Container>
    </>
  );
}
