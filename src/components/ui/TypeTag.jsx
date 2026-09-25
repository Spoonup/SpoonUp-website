import React from 'react';
import { ORDER_TYPES } from '../../lib/orderTypes';

/**
 * Small uppercase mono chip in one of the three order-type colours.
 * Default is the tinted fill used inline in cards and lists; `solid` is the
 * badge the shop grid overlays on a product photo, where a tint would not read.
 */
export default function TypeTag({ type = 'kitchen', solid = false, children, className = '' }) {
  const t = ORDER_TYPES[type] || ORDER_TYPES.kitchen;
  return (
    <span
      className={`inline-block self-start w-fit font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] rounded-tag ${
        solid ? 'px-2 py-1' : 'px-[7px] py-[3px]'
      } ${className}`}
      style={
        solid
          ? { background: t.color, color: 'var(--color-paper)' }
          : { background: t.tint, color: t.color }
      }
    >
      {children ?? t.badge}
    </span>
  );
}
