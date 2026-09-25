import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../../lib/useCart';
import { rupees } from '../../data/catalogue';

/** Dark card bottom-right; slides in over 200ms and auto-dismisses after ~4s. */
export default function CartToast() {
  const { toast, count, dismissToast } = useCart();
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex items-center gap-3 bg-ink text-paper rounded-card p-3.5 max-w-[360px] sm:max-w-none animate-[toastIn_200ms_ease-out]"
      style={{ boxShadow: '0 10px 30px rgba(27,42,24,.25)' }}
    >
      <img src={toast.image} alt="" className="w-11 h-11 rounded-md object-contain bg-paper/10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[11px] text-paper/70">Added to cart</p>
        <p className="m-0 text-[13px] font-medium truncate">{toast.name}</p>
        <p className="m-0 text-[12px] text-paper/70">{rupees(toast.price)}</p>
      </div>
      <Link
        to="/cart"
        onClick={dismissToast}
        className="bg-sage text-ink rounded-pill px-3.5 py-2 text-[12px] font-medium whitespace-nowrap hover:brightness-105 transition"
      >
        View cart · {count}
      </Link>
    </div>
  );
}
