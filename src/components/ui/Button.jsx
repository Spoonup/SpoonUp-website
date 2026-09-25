import React from 'react';
import { Link } from 'react-router-dom';

const VARIANTS = {
  // Primary CTA — olive fill.
  primary: 'bg-olive text-paper border border-olive hover:brightness-110',
  // Dark fill, used for cart pills, add-to-cart and anything on cream.
  dark: 'bg-ink text-paper border border-ink hover:brightness-125',
  // Outline on light surfaces.
  outline: 'bg-transparent text-ink border border-line-20 hover:bg-tint-ink',
  // Secondary CTA sitting on a dark surface.
  sage: 'bg-sage text-ink border border-sage hover:brightness-105',
  // Outline on a dark surface.
  outlineOnDark: 'bg-transparent text-paper border border-paper/30 hover:bg-paper/10',
  // Text link.
  text: 'bg-transparent text-olive border border-transparent hover:underline px-0 py-0'
};

const SIZES = {
  sm: 'px-3.5 py-2 text-[12.5px]',
  md: 'px-[18px] py-[10px] text-[13px]',
  lg: 'px-[26px] py-[14px] text-[14px]'
};

/**
 * One button for every surface in the design. Renders as <Link>, <a> or <button>
 * depending on which of `to` / `href` is supplied.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  pill = true,
  to,
  href,
  className = '',
  children,
  ...props
}) {
  const classes = [
    'inline-flex items-center justify-center gap-2 font-medium cursor-pointer pressable select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    pill ? 'rounded-pill' : 'rounded-btn',
    VARIANTS[variant] || VARIANTS.primary,
    variant === 'text' ? '' : SIZES[size] || SIZES.md,
    className
  ]
    .filter(Boolean)
    .join(' ');

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={classes} {...props}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
