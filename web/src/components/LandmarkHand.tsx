/**
 * The SignTalk mark: the 21 hand landmarks the tracker actually sees,
 * drawn as a constellation. Fingertips (4, 8, 12, 16, 20) carry the signal colour.
 */
const POINTS: readonly [number, number][] = [
  [50, 92], // 0 wrist
  [35, 84],
  [25, 74],
  [18, 64],
  [13, 54], // 4 thumb tip
  [37, 57],
  [34, 41],
  [32, 31],
  [31, 20], // 8 index tip
  [49, 55],
  [49, 37],
  [49, 25],
  [49, 13], // 12 middle tip
  [61, 57],
  [63, 40],
  [64, 29],
  [65, 19], // 16 ring tip
  [72, 63],
  [77, 51],
  [80, 43],
  [83, 35], // 20 pinky tip
];

const BONES: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const TIPS = new Set([4, 8, 12, 16, 20]);

const SEGMENTS = BONES.flatMap(([a, b]) => {
  const p = POINTS[a];
  const q = POINTS[b];
  return p && q ? [[p[0], p[1], q[0], q[1]] as const] : [];
});

export function LandmarkHand({
  size = 32,
  animated = false,
  className = '',
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`landmark-hand ${animated ? 'is-animated' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
    >
      <g className="lh-bones">
        {SEGMENTS.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} style={{ ['--i' as string]: i }} />
        ))}
      </g>
      <g className="lh-joints">
        {POINTS.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={TIPS.has(i) ? 5.2 : i === 0 ? 4.6 : 3.4}
            className={TIPS.has(i) ? 'tip' : undefined}
            style={{ ['--i' as string]: i }}
          />
        ))}
      </g>
    </svg>
  );
}
