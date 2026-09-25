import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Container from '../components/layout/Container';
import ProductCard from '../components/ui/ProductCard';
import Pill from '../components/ui/Pill';
import Button from '../components/ui/Button';
import { useCatalogue } from '../lib/useCatalogue';

const FILTERS = [
  { id: 'all', label: 'All', accent: null },
  { id: 'kitchen', label: 'Eat now', accent: '#4A5D2E' },
  { id: 'subscribable', label: 'Subscribable', accent: null },
  { id: 'pantry', label: 'Pantry · ships', accent: '#8B6A46' }
];

const SORTS = ['Popular', 'Price: low to high', 'Price: high to low'];

export default function Shop() {
  const { products, loading, source } = useCatalogue();
  const [params, setParams] = useSearchParams();
  const active = params.get('type') || 'all';
  const [quick, setQuick] = useState([]);
  const [sort, setSort] = useState('Popular');

  const toggleQuick = (id) =>
    setQuick((prev) => (prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]));

  const visible = useMemo(() => {
    let rows = products.filter((p) => {
      if (active === 'all') return true;
      if (active === 'subscribable') return p.subscribable;
      return p.type === active;
    });
    if (quick.includes('high-protein')) rows = rows.filter((p) => p.tags.includes('high-protein'));
    if (quick.includes('under-300')) rows = rows.filter((p) => p.price < 300);
    if (sort === 'Price: low to high') rows = [...rows].sort((a, b) => a.price - b.price);
    if (sort === 'Price: high to low') rows = [...rows].sort((a, b) => b.price - a.price);
    return rows;
  }, [products, active, quick, sort]);

  const setType = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'all') next.delete('type');
    else next.set('type', id);
    setParams(next, { replace: true });
  };

  return (
    <Container className="pt-[26px] pb-[44px]">
      {/* Screen 1b: title, type pills and the quick filters share one row. */}
      <div className="flex flex-wrap items-center gap-[14px] pb-[18px]">
        <h1 className="font-display text-[30px] leading-none text-ink m-0 mr-2.5">Shop all</h1>

        {FILTERS.map((f) => (
          <Pill
            key={f.id}
            selected={active === f.id}
            accent={active === f.id ? undefined : f.accent}
            onClick={() => setType(f.id)}
          >
            {f.label}
            {f.id === 'all' && ` · ${products.length}`}
          </Pill>
        ))}

        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2.5 text-[12.5px] font-medium">
          <button
            type="button"
            aria-pressed={quick.includes('high-protein')}
            onClick={() => toggleQuick('high-protein')}
            className={`whitespace-nowrap cursor-pointer pressable hover:text-ink transition-colors ${
              quick.includes('high-protein') ? 'text-olive underline underline-offset-4' : 'text-ink-60'
            }`}
          >
            High protein
          </button>
          <span className="text-ink-45" aria-hidden="true">·</span>
          <button
            type="button"
            aria-pressed={quick.includes('under-300')}
            onClick={() => toggleQuick('under-300')}
            className={`whitespace-nowrap cursor-pointer pressable hover:text-ink transition-colors ${
              quick.includes('under-300') ? 'text-olive underline underline-offset-4' : 'text-ink-60'
            }`}
          >
            Under ₹300
          </button>
          <span className="text-ink-45" aria-hidden="true">·</span>
          <label className="text-ink-60 flex items-center gap-1">
            Sort:
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort products"
              className="bg-transparent border-0 p-0 pr-1 text-[12.5px] font-medium text-ink-60 hover:text-ink cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
            >
              {SORTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-line-10 overflow-hidden">
              <div className="h-[180px] bg-cream animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-3.5 bg-cream rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-cream rounded animate-pulse" />
                <div className="h-9 bg-cream rounded-btn animate-pulse mt-3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger">
        {visible.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}

        <Link
          to="/subscribe"
          className="rounded-lg border border-dashed border-line-20 bg-cream p-6 flex flex-col justify-center items-center text-center gap-2.5 min-h-[300px] hover:border-olive transition"
        >
          <span className="font-display text-[20px] leading-[1.25] text-ink">
            Build a plan
            <br />
            instead
          </span>
          <span className="text-[12px] leading-[1.55] text-ink-60">
            Pick a product, a rhythm and a duration. Save up to 18%.
          </span>
          <span className="bg-olive text-paper rounded-pill px-[18px] py-2.5 text-[12.5px] font-medium mt-1">
            Open builder
          </span>
        </Link>
      </div>
      )}

      {source === 'mock' && !loading && (
        <p className="text-[11.5px] text-ink-45 mt-8 mb-0">
          Showing the design catalogue — the products API was unreachable.
        </p>
      )}

      {!loading && visible.length === 0 && (
        <div className="py-16 text-center">
          {active === 'subscribable' ? (
            <>
              {/* The catalogue API has no subscribable flag yet, so this filter can
                  return nothing. Send people to the builder rather than a dead end. */}
              <h2 className="font-display text-[23px] text-ink m-0">Plans are built in the builder</h2>
              <p className="text-[13.5px] leading-[1.6] text-ink-65 mt-2.5 mb-5 max-w-[420px] mx-auto">
                Pick a product, a rhythm and a duration there — you&apos;ll save up to 18% and pay
                into your plan wallet.
              </p>
              <Button to="/subscribe" variant="primary" size="md">Open the plan builder</Button>
            </>
          ) : (
            <>
              <p className="text-[14px] text-ink-55 m-0">Nothing matches those filters yet.</p>
              <button
                type="button"
                onClick={() => {
                  setType('all');
                  setQuick([]);
                }}
                className="text-[13px] text-olive hover:underline cursor-pointer pressable mt-3"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </Container>
  );
}
