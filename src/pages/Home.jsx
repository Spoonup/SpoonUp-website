import React from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Eyebrow from '../components/ui/Eyebrow';
import TypeTag from '../components/ui/TypeTag';
import Container from '../components/layout/Container';
import { useServiceArea } from '../lib/useServiceArea';

const STATS = [
  { value: '23g', label: 'protein per jar' },
  { value: '0g', label: 'added refined sugar' },
  { value: '4.8', label: 'avg. rating' }
];

const WAYS = [
  {
    type: 'kitchen',
    image: '/assets/generated/eat-now.jpg',
    tag: 'NOW · 30–45 MIN',
    title: 'Eat Now',
    copy: 'Straight from the kitchen. Smoothies, puddings, tikkis — or schedule it for 8pm tonight.',
    to: '/shop'
  },
  {
    type: 'plan',
    image: '/assets/generated/week-jars.jpg',
    tag: 'PLAN · UP TO 18% OFF',
    title: 'Subscribe',
    copy: 'Daily, alternate days or weekly. Pay once into your wallet, we deduct per delivery.',
    to: '/subscribe'
  },
  {
    type: 'pantry',
    image: '/assets/generated/pantry.jpg',
    tag: 'SHIPS · 3–5 DAYS',
    title: 'Pantry',
    copy: 'Kashmiri dry fruits, muesli and modak — sourced per order, never sitting in a warehouse.',
    to: '/shop?type=pantry'
  }
];

const TESTIMONIALS = [
  {
    quote: 'The pudding replaced my 4pm biscuit habit. I stopped noticing it was the healthy option.',
    name: 'Ananya R.',
    place: 'Bengaluru'
  },
  {
    quote: "Alternate-day plan, wallet does the rest. I haven't thought about breakfast in two months.",
    name: 'Karthik M.',
    place: 'Pune'
  },
  {
    quote: 'Dry fruits arrived in four days and tasted like they were packed that morning.',
    name: 'Meher S.',
    place: 'Delhi'
  }
];

export default function Home() {
  const { area, isServiceable, openPicker } = useServiceArea();

  return (
    <>
      {/* Hero — columns share a row so the image tracks the copy height instead of
          being pinned to an arbitrary pixel value. */}
      <section className="bg-cream">
        {/* Design: two equal columns, no gap — the image runs to the section edge. */}
        <Container flush className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center">
          <div className="px-5 sm:px-8 lg:px-10 py-12 lg:py-14 max-w-[600px]">
            <Eyebrow>Good food, higher days</Eyebrow>
            <h1 className="font-display text-[clamp(38px,5.2vw,62px)] leading-[1.02] text-ink mt-5 mb-0">
              Food that tastes like a <em className="italic">craving</em>, works like a nutrition plan.
            </h1>
            <p className="text-[16px] leading-[1.6] text-ink-72 max-w-[430px] mt-5 mb-0">
              Protein puddings, smoothies and real-ingredient snacks made fresh in our kitchen. Plus a
              hand-sourced pantry of dry fruits. No compromise on taste, none on what&apos;s inside.
            </p>

            <div className="flex flex-wrap gap-3 mt-8">
              <Button to="/shop" variant="primary" size="lg">
                Order in 30 min
              </Button>
              <Button to="/subscribe" variant="outline" size="lg">
                Build a subscription
              </Button>
            </div>

            <p className="text-[12.5px] leading-[1.6] text-ink-55 mt-4 mb-0">
              {isServiceable ? (
                <>
                  <span className="inline-block w-[7px] h-[7px] rounded-full bg-olive mr-1.5 align-middle" />
                  Delivering to{' '}
                  <span className="text-ink font-medium">
                    {area.area} {area.pincode}
                  </span>{' '}
                  in {area.eta}
                </>
              ) : (
                <>
                  <span className="inline-block w-[7px] h-[7px] rounded-full bg-almond mr-1.5 align-middle" />
                  No kitchen delivery to{' '}
                  <span className="text-ink font-medium">{area.pincode}</span> yet · pantry still ships
                </>
              )}{' '}
              ·{' '}
              <button
                type="button"
                onClick={openPicker}
                className="text-olive hover:underline cursor-pointer pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive rounded-sm"
              >
                Change
              </button>
            </p>

            <div className="flex flex-wrap gap-x-[30px] gap-y-5 mt-8 pt-7 border-t border-line-10">
              {STATS.map((s) => (
                <div key={s.label}>
                  <p className="font-display text-[22px] leading-none text-ink m-0">{s.value}</p>
                  <p className="text-[12px] text-ink-60 mt-1.5 mb-0">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="h-[320px] sm:h-[420px] lg:h-[560px]">
            <img
              src="/assets/generated/kitchen.jpg"
              alt="Chia pudding jars on a kitchen windowsill"
              className="w-full h-full object-cover"
            />
          </div>
        </Container>
      </section>

      {/* Three ways */}
      <section className="pt-[52px] pb-[52px]">
        <Container className="flex flex-wrap items-baseline justify-between gap-4 pb-[22px]">
          <h2 className="font-display text-[clamp(30px,3.4vw,40px)] leading-[1.1] text-ink m-0">
            Three ways to eat with us
          </h2>
          <Link to="/shop" className="text-[13px] text-olive hover:underline pressable">
            See everything →
          </Link>
        </Container>

        <Container className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 stagger">
          {WAYS.map((way) => (
            <Link
              key={way.title}
              to={way.to}
              className="group bg-white rounded-card border border-line-10 overflow-hidden flex flex-col lift"
            >
              <div className="h-[180px] bg-cream overflow-hidden">
                <img
                  src={way.image}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                  loading="lazy"
                />
              </div>
              <div className="p-5 flex flex-col gap-2 flex-1">
                <TypeTag type={way.type}>{way.tag}</TypeTag>
                <h3 className="font-display text-[23px] leading-[1.2] text-ink mt-1 mb-0">{way.title}</h3>
                <p className="text-[13.5px] leading-[1.6] text-ink-65 m-0">{way.copy}</p>
              </div>
            </Link>
          ))}
        </Container>
      </section>

      {/* Founder story */}
      <section className="bg-ink">
        <Container flush className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center">
          <div className="h-[280px] lg:h-[400px] order-2 lg:order-1">
            {/* TODO: Handle core functionality later — placeholder image, NOT the real founders. Do not ship. */}
            <img src="/assets/generated/founders.jpg" alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div className="order-1 lg:order-2 px-5 sm:px-8 lg:px-10 py-12 lg:py-14 max-w-[560px]">
            <Eyebrow className="!text-sage">Why we started</Eyebrow>
            <h2 className="font-display text-[clamp(28px,3.2vw,36px)] leading-[1.2] text-paper mt-4 mb-0">
              We never asked anyone to stop loving food.
            </h2>
            <p className="text-[14.5px] leading-[1.7] text-paper/70 mt-5 mb-0 max-w-[460px]">
              SpoonUp started at home, with recipes built for a foodie who had run his health into the
              ground and wasn&apos;t willing to live on salads. Eat healthy, eat longer, live longer —
              without giving up the part of you that loves to eat.
            </p>
            <div className="mt-7">
              <Button to="/our-story" variant="sage" size="lg">
                Read our story
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* Testimonials */}
      {/* Design: one 4-column band — the heading occupies the first cell. */}
      <section className="bg-cream py-[44px]">
        <Container className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4 items-start stagger">
          <h2 className="font-display text-[clamp(26px,3vw,34px)] leading-[1.1] text-ink m-0 self-center">
            What people keep
            <br />
            coming back for
          </h2>
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="bg-white rounded-lg border border-line-10 p-5 m-0 flex flex-col h-full lift">
              <blockquote className="m-0 text-[13.5px] leading-[1.6] text-ink-72 flex-1">“{t.quote}”</blockquote>
              <figcaption className="mt-4 text-[11.5px] text-ink-55">
                {t.name} · {t.place}
              </figcaption>
            </figure>
          ))}
        </Container>
      </section>
    </>
  );
}
