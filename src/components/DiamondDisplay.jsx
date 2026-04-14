/**
 * Baseball diamond SVG showing which bases are occupied.
 * r1 = first base, r2 = second base, r3 = third base.
 */
export default function DiamondDisplay({ r1, r2, r3 }) {
  const SIZE = 100;
  const CENTER = SIZE / 2;
  // Base positions (rotated square)
  const bases = {
    home: { cx: CENTER,      cy: SIZE - 10 },
    first: { cx: SIZE - 10,  cy: CENTER },
    second: { cx: CENTER,    cy: 10 },
    third:  { cx: 10,        cy: CENTER },
  };

  const OCCUPIED = '#f59e0b';
  const EMPTY = '#374151';
  const STROKE = '#6b7280';
  const BASE_R = 10;

  const basePath = [
    `M ${bases.home.cx} ${bases.home.cy}`,
    `L ${bases.first.cx} ${bases.first.cy}`,
    `L ${bases.second.cx} ${bases.second.cy}`,
    `L ${bases.third.cx} ${bases.third.cy}`,
    'Z',
  ].join(' ');

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width="100"
      height="100"
      aria-label={`Runners: ${[r1 && '1st', r2 && '2nd', r3 && '3rd'].filter(Boolean).join(', ') || 'bases empty'}`}
    >
      {/* Diamond outline */}
      <path
        d={basePath}
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Home plate */}
      <polygon
        points={`${bases.home.cx},${bases.home.cy - 8} ${bases.home.cx - 6},${bases.home.cy - 3} ${bases.home.cx - 6},${bases.home.cy + 4} ${bases.home.cx + 6},${bases.home.cy + 4} ${bases.home.cx + 6},${bases.home.cy - 3}`}
        fill="#9ca3af"
      />

      {/* 2nd base (top) */}
      <rect
        x={bases.second.cx - 8}
        y={bases.second.cy - 8}
        width="16"
        height="16"
        rx="2"
        fill={r2 ? OCCUPIED : EMPTY}
        stroke={STROKE}
        strokeWidth="1.5"
        transform={`rotate(45, ${bases.second.cx}, ${bases.second.cy})`}
      />

      {/* 1st base (right) */}
      <rect
        x={bases.first.cx - 8}
        y={bases.first.cy - 8}
        width="16"
        height="16"
        rx="2"
        fill={r1 ? OCCUPIED : EMPTY}
        stroke={STROKE}
        strokeWidth="1.5"
        transform={`rotate(45, ${bases.first.cx}, ${bases.first.cy})`}
      />

      {/* 3rd base (left) */}
      <rect
        x={bases.third.cx - 8}
        y={bases.third.cy - 8}
        width="16"
        height="16"
        rx="2"
        fill={r3 ? OCCUPIED : EMPTY}
        stroke={STROKE}
        strokeWidth="1.5"
        transform={`rotate(45, ${bases.third.cx}, ${bases.third.cy})`}
      />
    </svg>
  );
}
