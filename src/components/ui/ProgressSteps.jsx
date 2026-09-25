import React from 'react';
import { ORDER_TYPES } from '../../lib/orderTypes';

/** Four-step tracker, coloured by order type. `current` is a 0-based index. */
export default function ProgressSteps({ steps, current = 0, type = 'kitchen' }) {
  const color = (ORDER_TYPES[type] || ORDER_TYPES.kitchen).color;
  return (
    <div className="w-full">
      <div className="flex gap-1.5">
        {steps.map((step, i) => (
          <div key={step} className="flex-1">
            <div
              className="h-[3px] rounded-pill transition-[width] duration-400"
              style={{ background: i <= current ? color : 'rgba(27,42,24,.12)' }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {steps.map((step, i) => (
          <span
            key={step}
            className="flex-1 text-[10.5px] leading-tight"
            style={{ color: i <= current ? color : 'rgba(27,42,24,.45)' }}
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}
