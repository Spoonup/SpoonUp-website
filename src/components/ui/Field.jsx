import React from 'react';

/** Labelled input used across checkout, sign-in and admin forms. */
export default function Field({ label, hint, id, className = '', children, ...props }) {
  const inputId = id || `f-${label?.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="block text-[12.5px] font-medium text-ink mb-1.5">
          {label}
        </label>
      )}
      {children ?? (
        <input
          id={inputId}
          className="w-full bg-white border border-line-14 rounded-md px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink-45 focus:outline-none focus:border-olive transition"
          {...props}
        />
      )}
      {hint && <p className="text-[11.5px] text-ink-55 mt-1.5 mb-0">{hint}</p>}
    </div>
  );
}
