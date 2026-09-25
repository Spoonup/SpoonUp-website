import React from 'react';

/** − n +  quantity control used in the cart rows. */
export default function QtyStepper({ value, onChange, min = 1, max = 50 }) {
  const set = (next) => onChange?.(Math.max(min, Math.min(max, next)));
  const btn =
    'w-7 h-7 grid place-items-center rounded-md border border-line-14 text-ink hover:bg-tint-ink hover:border-line-20 cursor-pointer pressable select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" className={btn} onClick={() => set(value - 1)} disabled={value <= min} aria-label="Decrease quantity">
        −
      </button>
      <span key={value} className="min-w-5 text-center text-[13px] font-medium tabular-nums num-tick">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => set(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}
