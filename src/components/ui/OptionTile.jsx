import React from 'react';

/**
 * The plan-builder tile: 14px padding, 10px radius, 1.5px border.
 * Selected fills ink with paper text; the note turns sage on duration tiles.
 */
export default function OptionTile({ label, note, selected = false, greenNote = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="text-left rounded-lg p-3.5 cursor-pointer w-full pressable select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      style={{
        background: selected ? '#1B2A18' : '#FFFFFF',
        color: selected ? '#FCFBF7' : '#1B2A18',
        border: `1.5px solid ${selected ? '#1B2A18' : 'rgba(27,42,24,.14)'}`
      }}
    >
      <span className="block text-[13.5px] font-medium">{label}</span>
      {note && (
        <span
          className="block text-[11.5px] mt-0.5"
          style={{
            color: selected
              ? greenNote
                ? '#A8B98C'
                : 'rgba(252,251,247,.7)'
              : greenNote
                ? '#4A5D2E'
                : 'rgba(27,42,24,.55)'
          }}
        >
          {note}
        </span>
      )}
    </button>
  );
}
