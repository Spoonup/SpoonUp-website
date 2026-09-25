import React from 'react';
import { ORDER_TYPES } from '../../lib/orderTypes';

/**
 * The signature order-part pattern: 1px tinted border plus a 3px left (or top)
 * edge in the type colour, with a mono uppercase header. Reused across cart,
 * checkout, confirmation and account.
 */
export default function PartCard({ type = 'kitchen', header, right, edge = 'left', className = '', children }) {
  const t = ORDER_TYPES[type] || ORDER_TYPES.kitchen;
  const edgeStyle =
    edge === 'top' ? { borderTop: `3px solid ${t.color}` } : { borderLeft: `3px solid ${t.color}` };

  return (
    <section
      className={`bg-white rounded-lg border border-line-10 overflow-hidden ${className}`}
      style={edgeStyle}
    >
      {(header || right) && (
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-line-08 flex-wrap">
          <span
            className="font-mono text-[10px] font-medium uppercase tracking-[0.12em]"
            style={{ color: t.color }}
          >
            {header}
          </span>
          {right}
        </header>
      )}
      <div className="px-4 sm:px-5 py-4">{children}</div>
    </section>
  );
}
