import React from 'react';

/**
 * A section the handoff designs but the server does not model yet. It states the
 * gap plainly rather than rendering sample rows nobody can act on.
 */
export default function AdminPlaceholder({ title, blurb, needs }) {
  return (
    <div className="flex flex-col gap-[18px] max-w-[720px]">
      <div>
        <h1 className="font-display text-[26px] leading-none text-ink m-0">{title}</h1>
        <p className="text-[12.5px] leading-[1.65] text-ink-60 mt-2 mb-0">{blurb}</p>
      </div>

      <div className="bg-white border border-dashed border-line-20 rounded-lg p-8 text-center">
        <p className="text-[14px] font-medium text-ink m-0">Not connected yet</p>
        <p className="text-[13px] leading-[1.65] text-ink-60 mt-2 mb-0 max-w-[460px] mx-auto">
          {needs || 'This section is designed but has no server model behind it, so there is nothing to show.'}
        </p>
      </div>
    </div>
  );
}
