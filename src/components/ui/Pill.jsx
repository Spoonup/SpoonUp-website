import React from 'react';

/**
 * Filter chips, size chips and slot chips. `accent` tints the selected state in
 * one of the three order-type colours; unselected is always a hairline ink border.
 */
export default function Pill({
  selected = false,
  accent,
  as: Tag = 'button',
  className = '',
  children,
  ...props
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-pill text-[12.5px] font-medium px-4 py-[9px] cursor-pointer whitespace-nowrap pressable select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive';

  if (selected && !accent) {
    return (
      <Tag aria-pressed={Tag === 'button' ? true : undefined} className={`${base} bg-ink text-paper border border-ink ${className}`} {...props}>
        {children}
      </Tag>
    );
  }
  if (selected && accent) {
    return (
      <Tag
        aria-pressed={Tag === 'button' ? true : undefined}
        className={`${base} ${className}`}
        style={{ border: `1.5px solid ${accent}`, background: `${accent}1a`, color: accent }}
        {...props}
      >
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      aria-pressed={Tag === 'button' ? false : undefined}
      className={`${base} bg-transparent text-ink border border-line-20 hover:bg-tint-ink ${className}`}
      // 35% border, per the design's rgba(...,.35) outline pills.
      style={accent ? { borderColor: `${accent}59`, color: accent } : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}
