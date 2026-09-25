import React from 'react';

/**
 * The half-eaten cookie from screen 4c, transcribed from the design's own CSS.
 * Drawn rather than illustrated: a radial-gradient body, nine chips, five light
 * speckles, a bite made of overlapping dough + background circles, and crumbs.
 *
 * Coordinates are the design's, on a 215×232 stage. `scale` shrinks the whole
 * thing proportionally for small viewports.
 */

const SPECKLES = [
  [58, 34, 9],
  [120, 70, 7],
  [32, 128, 8],
  [96, 170, 6],
  [140, 128, 7]
];

// left, top, width, height, rotation
const CHIPS = [
  [40, 58, 17, 14, -12],
  [82, 44, 12, 10, 20],
  [78, 108, 15, 12, 8],
  [30, 98, 11, 9, -30],
  [50, 142, 18, 14, 15],
  [110, 150, 15, 12, -8],
  [128, 96, 13, 11, 35],
  [150, 148, 14, 12, -20],
  [166, 112, 11, 9, 10]
];

// The bite: a lighter dough ring first, then the page background over it, so the
// cut edge reads as exposed dough rather than a hole.
const BITE_DOUGH = [
  [142, -32, 90],
  [170, 28, 76],
  [104, -46, 72]
];
const BITE_CUT = [
  [148, -26, 78],
  [176, 34, 64],
  [110, -40, 60]
];

// left, top, width, height, colour, rotation
const CRUMBS = [
  [196, 112, 6, 5, '#C99257', 20],
  [186, 146, 9, 7, '#A8733D', -15],
  [203, 170, 6, 5, '#C99257', 40],
  [174, 196, 10, 8, '#B98347', 10],
  [150, 214, 5, 4, '#A8733D', -30],
  [196, 208, 4, 4, '#C99257', 0]
];

export default function Cookie({ scale = 1, className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 ${className}`}
      style={{
        width: 215 * scale,
        height: 232 * scale
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: 215, height: 232, transform: `scale(${scale})` }}
      >
        {/* ground shadow */}
        <span
          className="absolute rounded-full"
          style={{
            left: 28,
            right: 22,
            bottom: 4,
            height: 18,
            background: 'rgba(27,42,24,.16)',
            filter: 'blur(7px)'
          }}
        />

        {/* body */}
        <div
          className="absolute rounded-full overflow-hidden"
          style={{
            left: 5,
            top: 5,
            width: 200,
            height: 200,
            background:
              'radial-gradient(circle at 38% 34%, #E2B478 0%, #C99257 45%, #A8733D 85%, #8E5E2F 100%)',
            boxShadow:
              'inset 0 -9px 18px rgba(90,55,25,.38), inset 0 6px 12px rgba(255,235,200,.35)'
          }}
        >
          {SPECKLES.map(([left, top, size], i) => (
            <span
              key={`s${i}`}
              className="absolute rounded-full"
              style={{ left, top, width: size, height: size, background: 'rgba(255,232,196,.28)' }}
            />
          ))}

          {CHIPS.map(([left, top, w, h, rot], i) => (
            <span
              key={`c${i}`}
              className="absolute"
              style={{
                left,
                top,
                width: w,
                height: h,
                background: '#3A2314',
                borderRadius: '45% 55% 50% 40%',
                transform: `rotate(${rot}deg)`,
                boxShadow: 'inset 1px 1px 0 rgba(255,235,210,.18)'
              }}
            />
          ))}

          {BITE_DOUGH.map(([left, top, size], i) => (
            <span
              key={`bd${i}`}
              className="absolute rounded-full"
              style={{ left, top, width: size, height: size, background: '#E9C893' }}
            />
          ))}
          {BITE_CUT.map(([left, top, size], i) => (
            <span
              key={`bc${i}`}
              className="absolute rounded-full"
              style={{ left, top, width: size, height: size, background: '#F4F1E7' }}
            />
          ))}
        </div>

        {CRUMBS.map(([left, top, w, h, bg, rot], i) => (
          <span
            key={`cr${i}`}
            className="absolute"
            style={{
              left,
              top,
              width: w,
              height: h,
              background: bg,
              borderRadius: '40% 60% 45% 55%',
              transform: `rotate(${rot}deg)`
            }}
          />
        ))}
      </div>
    </div>
  );
}
