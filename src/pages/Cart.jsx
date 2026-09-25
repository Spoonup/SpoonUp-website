import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Container from '../components/layout/Container';
import PartCard from '../components/ui/PartCard';
import QtyStepper from '../components/ui/QtyStepper';
import Button from '../components/ui/Button';
import { useCart } from '../lib/useCart';
import { rupees, getProduct, FREE_SHIPPING_AT } from '../data/catalogue';



function Row({ row, onQty }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-line-08 last:border-0">
      <div className="w-16 h-16 rounded-lg bg-cream overflow-hidden shrink-0">
        <img src={row.image} alt="" className="w-full h-full object-contain p-1.5" loading="lazy" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink m-0 leading-snug">{row.name}</p>
        <p className="text-[12px] text-ink-55 m-0">
          {row.size ? `${row.size} · ` : ''}
          {rupees(row.unitPrice)} each
        </p>
      </div>
      <QtyStepper value={row.qty} onChange={(q) => onQty(row.key, q, row.type)} min={0} />
      <span className="text-[13.5px] font-medium text-ink w-[70px] text-right tabular-nums">
        {rupees(row.unitPrice * row.qty)}
      </span>
    </div>
  );
}

export default function Cart() {
  const { kitchen, pantry, plans, setQty, removePlan, kitchenTotal, pantryTotal, plansTotal, planDiscount, itemsTotal, count, groupCount, dropped, clearDropped } = useCart();
  const [mode, setMode] = useState('asap');

  const empty = count === 0;
  const shippingGap = Math.max(0, FREE_SHIPPING_AT - pantryTotal);
  const delivery = kitchen.length ? 49 : 0;

  if (empty) {
    return (
      <Container className="py-20 text-center">
        <h1 className="font-display text-[36px] text-ink m-0">Your cart is empty</h1>
        <p className="text-[14.5px] text-ink-65 mt-3 mb-7">
          Nothing here yet. The kitchen is warm and the pantry is stocked.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button to="/shop" variant="primary" size="lg">
            Browse the shop
          </Button>
          <Button to="/subscribe" variant="outline" size="lg">
            Build a plan
          </Button>
        </div>
      </Container>
    );
  }

  return (
    <Container className="pt-[34px] pb-[44px]">
      <h1 className="font-display text-[clamp(32px,4vw,46px)] text-ink m-0">Your cart</h1>
      <p className="text-[13.5px] text-ink-60 mt-3 mb-0">
        {count} {count === 1 ? 'item' : 'items'} · arrives in {groupCount}{' '}
        {groupCount === 1 ? 'delivery' : 'separate deliveries'}
      </p>

      {dropped.length > 0 && (
        <div className="mt-6 flex items-start justify-between gap-3 bg-tint-almond border border-almond/30 rounded-lg px-4 py-3">
          <p className="text-[12.5px] leading-[1.55] text-ink-72 m-0">
            {dropped.join(', ')} {dropped.length === 1 ? 'is' : 'are'} no longer on the menu, so{' '}
            {dropped.length === 1 ? 'it was' : 'they were'} removed from your cart.
          </p>
          <button
            type="button"
            onClick={clearDropped}
            className="text-[12px] text-ink-55 hover:text-ink cursor-pointer pressable shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1.65fr_1fr] items-start mt-10">
        <div className="space-y-5 stagger">
          {kitchen.length > 0 && (
            <PartCard
              type="kitchen"
              header="Eat now · from our kitchen"
              right={
                <div className="flex gap-1 bg-cream rounded-pill p-1">
                  {[
                    { id: 'asap', label: 'Now · ~40 min' },
                    { id: 'schedule', label: 'Schedule' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`rounded-pill px-3 py-1.5 text-[11.5px] font-medium cursor-pointer pressable ${
                        mode === m.id ? 'bg-ink text-paper' : 'text-ink-65 hover:text-ink'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              }
            >
              {kitchen.map((row) => (
                <Row key={row.key} row={row} onQty={setQty} />
              ))}
            </PartCard>
          )}

          {plans.map((plan) => {
            const product = getProduct(plan.productId);
            return (
              <PartCard
                key={plan.key}
                type="plan"
                header="Subscription plan"
                right={
                  <div className="flex gap-3">
                    <Link to={`/subscribe?product=${plan.productId}`} className="text-[12px] text-olive hover:underline">
                      Edit plan
                    </Link>
                    <button
                      type="button"
                      onClick={() => removePlan(plan.key)}
                      className="text-[12px] text-ink-50 hover:text-ink cursor-pointer pressable"
                    >
                      Remove
                    </button>
                  </div>
                }
              >
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg bg-cream overflow-hidden shrink-0">
                    <img src={product?.image} alt="" className="w-full h-full object-contain p-1.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-ink m-0">{product?.name}</p>
                    <p className="text-[12px] text-ink-55 m-0">
                      {plan.frequency} · {plan.durationLabel} · {plan.deliveries} deliveries · {plan.slot}
                    </p>
                    <p className="text-[12px] text-olive m-0 mt-0.5">First delivery {plan.startDate}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13.5px] font-medium text-ink m-0">{rupees(plan.net)}</p>
                    <p className="text-[11.5px] text-ink-45 line-through m-0">{rupees(plan.gross)}</p>
                    <p className="text-[11.5px] text-ink-55 m-0">{rupees(plan.perDelivery)}/delivery</p>
                  </div>
                </div>
              </PartCard>
            );
          })}

          {pantry.length > 0 && (
            <PartCard
              type="pantry"
              header="Pantry · ships in 3–5 days"
              right={
                <span className="text-[11.5px] text-almond">
                  {shippingGap > 0
                    ? `Free shipping over ${rupees(FREE_SHIPPING_AT)} · add ${rupees(shippingGap)} more`
                    : 'Free shipping unlocked'}
                </span>
              }
            >
              {pantry.map((row) => (
                <Row key={row.key} row={row} onQty={setQty} />
              ))}
            </PartCard>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 bg-cream rounded-card p-6">
          <h2 className="text-[15px] font-medium text-ink m-0 mb-4">Summary</h2>
          <dl className="m-0 space-y-2.5 text-[13.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-65">Items</dt>
              <dd className="m-0 text-ink tabular-nums">{rupees(kitchenTotal + pantryTotal + plansTotal + planDiscount)}</dd>
            </div>
            {planDiscount > 0 && (
              <div className="flex justify-between text-olive">
                <dt>Plan discount ({plans[0]?.pct ?? 14}%)</dt>
                <dd className="m-0 tabular-nums">−{rupees(planDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-65">Delivery &amp; packaging</dt>
              <dd className="m-0 text-ink tabular-nums">{delivery ? rupees(delivery) : 'Free'}</dd>
            </div>
            <div className="flex justify-between items-baseline pt-3 border-t border-line-12">
              <dt className="text-[14px] font-medium text-ink">Estimated total</dt>
              <dd key={itemsTotal + delivery} className="m-0 font-display text-[26px] text-ink tabular-nums num-tick">
                {rupees(itemsTotal + delivery)}
              </dd>
            </div>
          </dl>

          <p className="text-[11.5px] text-ink-55 mt-2 mb-4">Coupons and GST are applied at checkout.</p>

          <Button to="/checkout" variant="primary" size="lg" className="w-full">
            Continue to checkout
          </Button>
          <p className="text-[11.5px] text-ink-55 text-center mt-2.5 mb-0">
            No account needed first — you&apos;ll verify your phone number at checkout.
          </p>
        </aside>
      </div>
    </Container>
  );
}
