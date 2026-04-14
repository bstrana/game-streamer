/**
 * Baseball diamond — three rotated squares for 1st, 2nd, 3rd base.
 * Occupied bases are amber; empty bases are dark.
 */
export default function DiamondDisplay({ r1, r2, r3 }) {
  const occupied = '#fbbf24';
  const empty    = 'rgba(255,255,255,0.12)';
  const stroke   = 'rgba(255,255,255,0.4)';

  return (
    <svg
      width="96"
      height="88"
      viewBox="-15 -15 90 90"
      style={{ display: 'block' }}
      aria-label={`Runners: ${[r1 && '1st', r2 && '2nd', r3 && '3rd'].filter(Boolean).join(', ') || 'bases empty'}`}
    >
      {/* 2nd base (top) */}
      <rect
        x="19" y="1" width="22" height="22"
        transform="rotate(45 30 12)"
        fill={r2 ? occupied : empty}
        stroke={stroke}
        strokeWidth="0.9"
      />
      {/* 3rd base (left) */}
      <rect
        x="1" y="33" width="22" height="22"
        transform="rotate(45 12 44)"
        fill={r3 ? occupied : empty}
        stroke={stroke}
        strokeWidth="0.9"
      />
      {/* 1st base (right) */}
      <rect
        x="37" y="33" width="22" height="22"
        transform="rotate(45 48 44)"
        fill={r1 ? occupied : empty}
        stroke={stroke}
        strokeWidth="0.9"
      />
    </svg>
  );
}
