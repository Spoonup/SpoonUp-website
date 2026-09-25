import React from 'react';
import Container from './Container';

/**
 * Vertical rhythm. The spec calls for 44–64px section padding; these steps keep
 * every page on the same scale instead of each one inventing its own py-*.
 */
// Design section padding is 44–52px vertical, not the 56–96px we had.
const SPACE = {
  sm: 'py-8 lg:py-9',
  md: 'py-10 lg:py-11',
  lg: 'py-11 lg:py-13',
  xl: 'py-12 lg:py-[52px]'
};

const TONES = {
  paper: 'bg-paper',
  cream: 'bg-cream',
  ink: 'bg-ink text-paper',
  none: ''
};

export default function Section({
  tone = 'none',
  space = 'md',
  width,
  bleed = false,
  className = '',
  containerClassName = '',
  children
}) {
  const inner = bleed ? children : <Container width={width} className={containerClassName}>{children}</Container>;
  return <section className={`${TONES[tone] || ''} ${SPACE[space] || SPACE.md} ${className}`}>{inner}</section>;
}
