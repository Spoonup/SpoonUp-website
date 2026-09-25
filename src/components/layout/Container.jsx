import React from 'react';

/**
 * Full-bleed by default: content spans the viewport instead of sitting in a
 * centred column with dead margins either side. The small gutter exists only so
 * text never touches the glass — set `flush` for true edge-to-edge (images, bands).
 */
const WIDTHS = {
  default: 'max-w-none',
  wide: 'max-w-none',
  narrow: 'max-w-[1440px]',
  prose: 'max-w-[760px]'
};

export default function Container({
  width = 'default',
  flush = false,
  className = '',
  as: Tag = 'div',
  children
}) {
  // The design draws every screen with a 40px side gutter (20/32 stepped down
  // for small viewports). This is the single horizontal rhythm for the site.
  const gutter = flush ? 'px-0' : 'px-5 sm:px-8 lg:px-10';
  return (
    <Tag className={`${WIDTHS[width] || WIDTHS.default} mx-auto w-full ${gutter} ${className}`}>
      {children}
    </Tag>
  );
}
