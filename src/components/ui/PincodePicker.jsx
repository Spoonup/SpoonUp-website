import React, { useEffect, useRef, useState } from 'react';
import { useServiceArea } from '../../lib/useServiceArea';
import { SERVICE_AREAS } from '../../data/serviceAreas';

/**
 * Serviceability picker. The handoff notes this screen "is not drawn yet", so it
 * follows the site's existing pill/card language rather than inventing a new one.
 */
export default function PincodePicker() {
  const { pickerOpen } = useServiceArea();
  // Remount on open so the form starts fresh without resetting state in an effect.
  if (!pickerOpen) return null;
  return <PincodeDialog />;
}

function PincodeDialog() {
  const { closePicker, check, apply, area } = useServiceArea();
  const [value, setValue] = useState(area.pincode || '');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape') closePicker();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [closePicker]);

  const submit = (e) => {
    e.preventDefault();
    const res = check(value);
    setResult(res);
    if (res.status === 'serviceable') apply(res);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 animate-fade-in"
      onClick={closePicker}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pincode-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] bg-paper rounded-card border border-line-12 p-6 animate-expand"
        style={{ boxShadow: '0 10px 30px rgba(27,42,24,.25)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-almond m-0">
              Delivery area
            </p>
            <h2 id="pincode-title" className="font-display text-[26px] leading-[1.15] text-ink mt-2 mb-0">
              Where are we delivering?
            </h2>
          </div>
          <button
            type="button"
            onClick={closePicker}
            aria-label="Close"
            className="text-ink-50 hover:text-ink text-[18px] leading-none cursor-pointer pressable shrink-0"
          >
            ✕
          </button>
        </div>

        <p className="text-[13px] leading-[1.6] text-ink-65 mt-3 mb-4">
          Kitchen items need a serviceable pincode. Pantry orders ship anywhere in India.
        </p>

        <form onSubmit={submit} className="flex gap-2.5">
          <label htmlFor="pincode-input" className="sr-only">
            Six-digit pincode
          </label>
          <input
            id="pincode-input"
            ref={inputRef}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            value={value}
            onChange={(e) => {
              setValue(e.target.value.replace(/\D/g, '').slice(0, 6));
              setResult(null);
            }}
            placeholder="560095"
            className="flex-1 min-w-0 bg-white border border-line-16 rounded-pill px-5 py-3 text-[14px] font-mono tracking-[0.08em] text-ink placeholder:text-ink-45 focus:outline-none focus:border-olive transition"
          />
          <button
            type="submit"
            className="bg-ink text-paper rounded-pill px-5 py-3 text-[13.5px] font-medium cursor-pointer pressable hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
          >
            Check
          </button>
        </form>

        <div aria-live="polite" className="min-h-[24px] mt-3">
          {result?.status === 'invalid' && (
            <p className="text-[12.5px] text-almond m-0">Enter all six digits of your pincode.</p>
          )}
          {result?.status === 'unserviced' && (
            <p className="text-[12.5px] leading-[1.6] text-almond m-0">
              We don&apos;t deliver from the kitchen to {result.pincode} yet. You can still order
              pantry items — they ship by courier in 3–5 days.
            </p>
          )}
          {result?.status === 'serviceable' && (
            <p className="text-[12.5px] text-olive m-0">
              ✓ Delivering to {result.area} in {result.eta}
            </p>
          )}
        </div>

        {result?.status === 'unserviced' && (
          <button
            type="button"
            onClick={() => apply(result)}
            className="w-full mt-2 border border-line-20 text-ink rounded-pill py-2.5 text-[13px] font-medium cursor-pointer pressable hover:bg-tint-ink"
          >
            Continue with pantry only
          </button>
        )}

        <div className="mt-5 pt-4 border-t border-line-10">
          <p className="text-[11.5px] text-ink-55 m-0 mb-2.5">We currently deliver to</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_AREAS.map((a) => (
              <button
                key={a.pincode}
                type="button"
                onClick={() => apply({ ...a, status: 'serviceable' })}
                className={`rounded-pill px-3.5 py-2 text-[12px] font-medium cursor-pointer pressable border transition ${
                  a.pincode === area.pincode
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-transparent text-ink border-line-16 hover:bg-tint-ink'
                }`}
              >
                {a.area} · {a.pincode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
