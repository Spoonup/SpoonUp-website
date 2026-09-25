import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Eyebrow from '../components/ui/Eyebrow';
import OptionTile from '../components/ui/OptionTile';
import { SUBSCRIBABLE, PER_MONTH, planQuote, rupees, getProduct } from '../data/catalogue';
import { useCart } from '../lib/useCart';
import { useServiceArea } from '../lib/useServiceArea';
import Container from '../components/layout/Container';

const FREQUENCIES = Object.keys(PER_MONTH);
const DURATIONS = [
  { label: '1 month', months: 1, pct: 8 },
  { label: '2 months', months: 2, pct: 14 },
  { label: '3 months', months: 3, pct: 18 }
];
const SLOTS = [
  { label: '7–9 am', note: 'Breakfast' },
  { label: '12–2 pm', note: 'Lunch' },
  { label: '6–8 pm', note: 'Evening' }
];

/** Four upcoming start dates, generated from today so the mock never goes stale. */
function startOptions() {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const out = [];
  for (let i = 1; out.length < 4; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const parts = fmt.format(d);
    out.push({
      label: out.length === 0 ? 'Tomorrow' : parts.split(' ')[0].replace(',', ''),
      note: parts.replace(/^\w+,?\s/, ''),
      date: parts
    });
  }
  return out;
}

const STARTS = startOptions();

/** Numbered builder section. Declared at module scope so its subtree keeps state. */
function Step({ n, title, children, hint }) {
  return (
    <section className="border-t border-line-10 pt-7 first:border-0 first:pt-0">
      <h3 className="text-[17px] font-medium text-ink m-0 mb-1">
        <span className="text-almond font-normal">{n} · </span>
        {title}
      </h3>
      {hint && <p className="text-[12.5px] text-ink-55 mt-0 mb-4">{hint}</p>}
      <div className={hint ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

export default function Subscribe() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addPlan } = useCart();
  const { area, openPicker } = useServiceArea();

  const initial = getProduct(params.get('product'))?.subscribable
    ? getProduct(params.get('product'))
    : SUBSCRIBABLE[0];

  const [product, setProduct] = useState(initial);
  const [frequency, setFrequency] = useState('Alternate days');
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [start, setStart] = useState(0);
  const [slot, setSlot] = useState(SLOTS[0].label);

  const quote = planQuote(product.price, frequency, duration.months);

  const handleStart = () => {
    addPlan({
      productId: product.id,
      frequency,
      months: duration.months,
      durationLabel: duration.label,
      slot,
      startDate: STARTS[start].date,
      ...quote
    });
    navigate('/cart');
  };

  return (
    <>
      {/* Hero */}
      <section className="bg-cream">
        <Container className="grid gap-10 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center py-12 lg:py-14">
          <div>
            <Eyebrow>Subscriptions</Eyebrow>
            <h1 className="font-display text-[clamp(34px,4.6vw,54px)] leading-[1.05] text-ink mt-4 mb-0">
              Decide once. Then just <em className="italic">eat</em>.
            </h1>
            <p className="text-[16px] leading-[1.65] text-ink-72 max-w-[520px] mt-5 mb-0">
              Pick a product, a rhythm and a duration. You pay for the whole plan up front — it sits in
              your SpoonUp wallet and we deduct one delivery at a time. Skip days, pause, change your
              slot; the deliveries you paid for never expire.
            </p>
            <div className="flex flex-wrap gap-8 mt-7">
              {[
                ['up to 18%', 'off vs one-off'],
                ['4 rhythms', 'daily to weekly'],
                ['0 fees', 'to pause or skip']
              ].map(([value, label]) => (
                <div key={label}>
                  <p className="font-display text-[22px] text-ink m-0">{value}</p>
                  <p className="text-[12px] text-ink-60 mt-1 mb-0">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-card overflow-hidden h-[300px] lg:h-full lg:min-h-[460px]">
            <img src="/assets/generated/week-jars.jpg" alt="" className="w-full h-full object-cover" />
          </div>
        </Container>
      </section>

      {/* Builder */}
      <Container className="pt-[44px] pb-[18px]">
        <h2 className="font-display text-[clamp(26px,3vw,34px)] text-ink m-0">Build your plan</h2>
        <p className="text-[13px] text-ink-55 mt-2 mb-0">
          Everything below is editable later from My plans
        </p>
      </Container>

      <Container className="pb-[52px] grid gap-8 lg:gap-10 lg:grid-cols-[1.4fr_1fr] items-start">
        <div className="space-y-7">
          <Step n={1} title="Choose a product">
            <div className="grid gap-3 sm:grid-cols-3">
              {SUBSCRIBABLE.slice(0, 3).map((p) => {
                const selected = p.id === product.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProduct(p)}
                    aria-pressed={selected}
                    className="text-left bg-white rounded-lg p-3 cursor-pointer pressable"
                    style={{ border: selected ? '2px solid #4A5D2E' : '1px solid rgba(27,42,24,.14)' }}
                  >
                    <div className="h-[96px] bg-cream rounded-md mb-2.5 overflow-hidden">
                      <img src={p.image} alt="" className="w-full h-full object-contain p-2" loading="lazy" />
                    </div>
                    <span className="block text-[13.5px] font-medium text-ink leading-snug">{p.name}</span>
                    <span className="block text-[12px] text-ink-55 mt-0.5">{rupees(p.price)} one-off</span>
                  </button>
                );
              })}
            </div>
          </Step>

          <Step n={2} title="How often?">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {FREQUENCIES.map((f) => (
                <OptionTile
                  key={f}
                  label={f}
                  note={`${PER_MONTH[f]} / month`}
                  selected={f === frequency}
                  onClick={() => setFrequency(f)}
                />
              ))}
            </div>
          </Step>

          <Step
            n={3}
            title="For how long?"
            hint="The discount is always tied to the number of deliveries in the plan, never to the calendar. Pause or skip and the deliveries you paid for simply move to the end."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {DURATIONS.map((d) => (
                <OptionTile
                  key={d.label}
                  label={d.label}
                  note={`${d.pct}% off deliveries`}
                  greenNote
                  selected={d.months === duration.months}
                  onClick={() => setDuration(d)}
                />
              ))}
            </div>
          </Step>

          <Step n={4} title="First delivery">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {STARTS.map((s, i) => (
                <OptionTile
                  key={s.date}
                  label={s.label}
                  note={s.note}
                  selected={i === start}
                  onClick={() => setStart(i)}
                />
              ))}
            </div>
          </Step>

          <Step n={5} title="Time slot & address">
            <div className="grid gap-3 sm:grid-cols-3">
              {SLOTS.map((s) => (
                <OptionTile
                  key={s.label}
                  label={s.label}
                  note={s.note}
                  selected={s.label === slot}
                  onClick={() => setSlot(s.label)}
                />
              ))}
            </div>
            {/* Addresses are collected at checkout; there is no address book yet. */}
            <div className="mt-3 bg-white border border-line-12 rounded-lg p-4 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink m-0">
                  {area.pincode ? `Delivering to ${area.area} ${area.pincode}` : 'No delivery area set'}
                </p>
                <p className="text-[12px] text-ink-55 m-0 mt-0.5">
                  You&apos;ll enter the full address at checkout.
                </p>
              </div>
              <button
                type="button"
                onClick={openPicker}
                className="text-[12.5px] text-olive hover:underline cursor-pointer pressable"
              >
                Change
              </button>
            </div>
          </Step>
        </div>

        {/* Sticky summary */}
        <aside className="lg:sticky lg:top-28">
          <div className="bg-ink text-paper rounded-card p-6">
            <Eyebrow className="!text-sage">Your plan</Eyebrow>
            <h2 className="font-display text-[26px] text-paper mt-3 mb-1">{product.name}</h2>
            <p className="text-[13px] text-paper/70 m-0">
              {frequency} · {duration.label} · {quote.deliveries} deliveries · {slot}
            </p>
            <p className="text-[13px] text-paper/70 mt-1 mb-0">
              First delivery {STARTS[start].date}
            </p>

            <div className="mt-6 space-y-2 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-paper/70">
                  {rupees(product.price)} × {quote.deliveries}
                </span>
                <span>{rupees(quote.gross)}</span>
              </div>
              <div className="flex justify-between text-sage">
                <span>Plan discount {quote.pct}%</span>
                <span>−{rupees(quote.discount)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-3 border-t border-paper/15">
                <span className="text-[13.5px]">Plan price</span>
                <span key={quote.net} className="font-display text-[30px] leading-none num-tick">
                  {rupees(quote.net)}
                </span>
              </div>
            </div>

            <p className="text-[12.5px] text-paper/70 mt-2 mb-0">
              {rupees(quote.perDelivery)} per delivery · against {rupees(product.price)} buying one-off
            </p>

            <p className="text-[12.5px] text-sage-light mt-3 mb-0">
              You save {rupees(quote.discount)} against buying {quote.deliveries} jars one-off
            </p>

            <button
              type="button"
              onClick={handleStart}
              className="w-full mt-5 bg-olive text-paper rounded-pill py-3.5 text-[14px] font-medium hover:brightness-110 cursor-pointer pressable"
            >
              Start plan · {rupees(quote.net)}
            </button>
            <p className="text-[11.5px] text-paper/60 text-center mt-2 mb-0">
              Adds to your cart · paid into your plan wallet at checkout
            </p>

            <ul className="list-none p-0 mt-5 mb-0 space-y-1.5">
              {[
                'Skip or pause any day, free — skipped deliveries move to the end',
                'Paid deliveries never expire',
                'Change slot, address or start date from My plans'
              ].map((line) => (
                <li key={line} className="text-[12.5px] text-paper/75 flex gap-2">
                  <span className="text-sage">✓</span>
                  {line}
                </li>
              ))}
            </ul>

            <p className="text-[10.5px] leading-[1.55] text-paper/55 mt-4 mb-0">
              Plan balance is used only for this plan&apos;s deliveries and can&apos;t be withdrawn. For
              exceptions, email support@spoonupfoods.com. See Wallet &amp; Subscription terms.
            </p>
          </div>
        </aside>
      </Container>

      <section className="bg-cream">
        <Container className="py-[44px]">
          <h2 className="font-display text-[clamp(26px,3vw,34px)] text-ink m-0">How the wallet works</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mt-9 stagger">
            {[
              [
                '1 · You pay for the plan.',
                'The discounted amount lands in your SpoonUp wallet as a plan balance, ring-fenced to that subscription.'
              ],
              [
                '2 · We deduct per delivery.',
                'Each jar delivered draws its own rate — you always see the remaining balance and remaining deliveries.'
              ],
              [
                '3 · Skip freely.',
                'Skipped days move to the end of the plan, so nothing is lost.'
              ],
              [
                '4 · No withdrawals.',
                'Plan balance isn\u2019t cashable. Genuine exceptions are handled over email, case by case.'
              ]
            ].map(([title, body]) => (
              <div key={title} className="bg-white rounded-card border border-line-10 p-5">
                <h3 className="text-[14px] font-medium text-ink m-0">{title}</h3>
                <p className="text-[13px] leading-[1.65] text-ink-65 mt-2.5 mb-0">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
