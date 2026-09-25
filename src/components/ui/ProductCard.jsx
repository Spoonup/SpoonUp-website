import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import TypeTag from './TypeTag';
import { planQuote, rupees } from '../../data/catalogue';
import { useCart } from '../../lib/useCart';

/**
 * Shop grid card, built to the handoff's screen 1b measurements: 180px photo with
 * a solid type badge at 10/10, 16px body, 15/12/17px type scale, one primary
 * action. Subscribable items add a text link into the builder; pantry items add
 * size chips above the button.
 */
export default function ProductCard({ product }) {
  const { addItem } = useCart();
  const [size, setSize] = useState(product.sizes?.[0]);
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(addedTimer.current), []);

  const handleAdd = () => {
    addItem(product, { size });
    setJustAdded(true);
    window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(false), 1400);
  };
  const unitPrice = size ? size.price : product.price;

  const hint = product.subscribable ? (
    <span className="text-olive">
      from {rupees(planQuote(unitPrice, 'Alternate days', 3).perDelivery)}/{product.planUnit || 'jar'} on a plan
    </span>
  ) : product.type === 'pantry' ? (
    <span className={product.shippingNote ? 'text-almond' : 'text-ink-45'}>
      {product.shippingNote || 'Made fresh, ships chilled'}
    </span>
  ) : (
    <span className="text-ink-45">Eat-now only</span>
  );

  return (
    <article className="group bg-white rounded-lg border border-line-10 overflow-hidden flex flex-col lift">
      <div className="relative h-[180px] bg-cream overflow-hidden shrink-0">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          loading="lazy"
        />
        <div className="absolute top-2.5 left-2.5 pointer-events-none">
          <TypeTag type={product.type} solid>
            {product.badge}
          </TypeTag>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-[15px] font-medium text-ink m-0 leading-[1.3] line-clamp-2">{product.name}</h3>
        <p className="text-[12px] leading-[1.5] text-ink-60 mt-[5px] mb-2.5 line-clamp-2">{product.meta}</p>

        <div className="flex items-baseline gap-2">
          <span className="text-[17px] font-medium text-ink">{rupees(unitPrice)}</span>
          {product.mrp && !size && (
            <span className="text-[11px] text-ink-45 line-through">{rupees(product.mrp)}</span>
          )}
        </div>

        <p className="text-[11.5px] leading-[1.5] mt-1 mb-0">{hint}</p>

        <div className="mt-auto pt-3 flex flex-col gap-2.5">
          {product.sizes && (
            <div className="flex flex-wrap gap-1.5">
              {product.sizes.map((s) => {
                const on = size?.label === s.label;
                return (
                  <button
                    key={s.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSize(s)}
                    className="rounded-pill text-[11.5px] font-medium cursor-pointer pressable whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
                    style={
                      on
                        ? {
                            color: 'var(--color-almond)',
                            background: 'var(--color-tint-almond)',
                            border: '1.5px solid var(--color-almond)',
                            padding: '5px 12px'
                          }
                        : {
                            color: 'var(--color-ink)',
                            border: '1px solid rgba(27,42,24,.15)',
                            padding: '5.5px 12px'
                          }
                    }
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={handleAdd}
            aria-live="polite"
            className={`w-full rounded-btn py-[11px] text-[12.5px] font-medium cursor-pointer pressable select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive ${
              justAdded ? 'bg-olive text-paper' : 'bg-ink text-paper hover:brightness-125'
            }`}
          >
            <span key={justAdded ? 'added' : 'idle'} className="inline-block animate-fade-in">
              {justAdded ? '✓ Added to cart' : 'Add to cart'}
            </span>
          </button>

          {product.subscribable && (
            <Link
              to={`/subscribe?product=${product.id}`}
              className="block text-center text-[12px] font-medium text-olive hover:underline pressable"
            >
              Subscribe &amp; save →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
