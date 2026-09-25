import React from 'react';

/** JetBrains Mono, uppercase, wide tracking — the section label used on every screen. */
export default function Eyebrow({ as: Tag = 'p', className = '', children, ...props }) {
  return (
    <Tag
      className={`font-mono text-[11px] uppercase tracking-[0.14em] text-almond m-0 ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}
