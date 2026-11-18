import { useEffect, useRef } from 'react';
import { motionReduced } from './motion';

/**
 * The animated SignTalk mark: the same 21 MediaPipe landmarks as LandmarkHand,
 * drawn in, morphing between hand shapes, with signal rings off the fingertips.
 * Purely decorative — it never shows a real KRSL sign.
 */
type Pt = [number, number];

const OPEN: Pt[] = [
  [50, 92],
  [35, 84],
  [25, 74],
  [18, 64],
  [13, 54],
  [37, 57],
  [34, 41],
  [32, 31],
  [31, 20],
  [49, 55],
  [49, 37],
  [49, 25],
  [49, 13],
  [61, 57],
  [63, 40],
  [64, 29],
  [65, 19],
  [72, 63],
  [77, 51],
  [80, 43],
  [83, 35],
];
const W: Pt[] = [[50, 92]];
const TA: Pt[] = [
  [37, 84],
  [31, 75],
  [36, 66],
  [44, 62],
];
const IC: Pt[] = [
  [37, 57],
  [36, 46],
  [41, 41],
  [43, 49],
];
const MC: Pt[] = [
  [49, 55],
  [49, 44],
  [54, 39],
  [55, 48],
];
const RC: Pt[] = [
  [61, 57],
  [62, 47],
  [66, 43],
  [66, 51],
];
const PC: Pt[] = [
  [72, 63],
  [73, 55],
  [76, 51],
  [75, 58],
];
const POSES: Pt[][] = [
  OPEN,
  [...W, ...TA, ...OPEN.slice(5, 9), ...MC, ...RC, ...PC],
  [
    ...W,
    ...TA,
    [37, 57],
    [31, 42],
    [27, 32],
    [23, 21],
    [49, 55],
    [52, 38],
    [54, 27],
    [56, 15],
    ...RC,
    ...PC,
  ],
  [
    ...W,
    [35, 84],
    [25, 75],
    [21, 66],
    [26, 55],
    [37, 57],
    [32, 46],
    [25, 46],
    [25, 54],
    [49, 55],
    [51, 37],
    [52, 25],
    [53, 13],
    [61, 57],
    [65, 41],
    [68, 30],
    [70, 20],
    [72, 63],
    [79, 52],
    [84, 44],
    [88, 36],
  ],
  [...W, ...TA, ...IC, ...MC, ...RC, ...PC],
  [
    ...W,
    [35, 84],
    [24, 77],
    [15, 70],
    [7, 63],
    ...IC,
    ...MC,
    ...RC,
    [72, 63],
    [79, 52],
    [84, 44],
    [89, 35],
  ],
];
const BONES: [number, number][] = [
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
const TIPS = [4, 8, 12, 16, 20];
const delayOf = (i: number) => (i === 0 ? 0 : ((i - 1) % 4) * 45 + Math.floor((i - 1) / 4) * 18);
const ORIGIN: Pt = [50, 92];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const pose = (i: number): Pt[] => POSES[((i % POSES.length) + POSES.length) % POSES.length] ?? OPEN;

export type HandMode = 'mark' | 'hero' | 'track';

export function LiveHand({
  mode = 'mark',
  pose: poseIndex,
  labels = false,
  still = false,
  tag,
  interval = 2600,
  replayOnHover = false,
  className = '',
}: {
  mode?: HandMode;
  /** Fixed pose; when omitted, hero/track hands cycle through poses on their own. */
  pose?: number;
  labels?: boolean;
  still?: boolean;
  tag?: string;
  interval?: number;
  /** Redraw the hand when the closest `[data-hover]` ancestor is hovered. */
  replayOnHover?: boolean;
  className?: string;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const opts = useRef({ mode, labels, still, tag, interval });
  useEffect(() => {
    opts.current = { mode, labels, still, tag, interval };
  });
  const target = useRef<number | undefined>(poseIndex);
  const state = useRef<{ go?: ((i: number) => void) | undefined }>({});

  useEffect(() => {
    target.current = poseIndex;
    if (poseIndex !== undefined) state.current.go?.(poseIndex);
  }, [poseIndex]);

  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    const lines = [...root.querySelectorAll<SVGLineElement>('.lv-bone')];
    const dots = [...root.querySelectorAll<SVGCircleElement>('.lv-joint')];
    const rings = [...root.querySelectorAll<SVGCircleElement>('.lv-ring')];
    const nums = [...root.querySelectorAll<SVGTextElement>('.lv-num')];
    const box = [...root.querySelectorAll<SVGPathElement>('.lv-corner')];
    const boxText = root.querySelector<SVGTextElement>('.lv-tag');
    const gLabels = root.querySelector<SVGGElement>('.lv-labels');
    const gBox = root.querySelector<SVGGElement>('.lv-box');

    const start = performance.now();
    let intro = start;
    let autoAt = start;
    let autoI = target.current ?? 0;
    const cur: Pt[] = pose(autoI).map((p) => [p[0], p[1]]);
    let from: Pt[] = cur.map((p) => [p[0], p[1]]);
    let to: Pt[] = pose(autoI);
    let morphAt = start - 5000;
    const go = (i: number) => {
      from = cur.map((p) => [p[0], p[1]]);
      to = pose(i);
      morphAt = performance.now();
    };
    const handle = state.current;
    handle.go = go;

    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(root);

    const host = replayOnHover ? root.closest('[data-hover]') : null;
    const replay = () => {
      intro = performance.now();
    };
    host?.addEventListener('mouseenter', replay);

    const set = (el: Element | undefined, name: string, value: number | string) => {
      el?.setAttribute(name, String(value));
    };

    const frame = (now: number) => {
      const o = opts.current;
      const isStill = o.still || motionReduced();
      if (
        target.current === undefined &&
        o.mode !== 'mark' &&
        !isStill &&
        now - autoAt > o.interval
      ) {
        autoAt = now;
        autoI = (autoI + 1) % POSES.length;
        go(autoI);
      }
      const pts: Pt[] = [];
      for (let i = 0; i < 21; i++) {
        const k = isStill ? 1 : clamp((now - morphAt - delayOf(i)) / 850);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const f = from[i] ?? ORIGIN;
        const t = to[i] ?? ORIGIN;
        const c = cur[i] ?? [ORIGIN[0], ORIGIN[1]];
        c[0] = f[0] + (t[0] - f[0]) * e;
        c[1] = f[1] + (t[1] - f[1]) * e;
        let x = c[0];
        let y = c[1];
        if (!isStill) {
          const a = o.mode === 'track' ? 0.5 : o.mode === 'hero' ? 0.25 : 0;
          x += Math.sin(now * 0.0021 + i * 1.7) * a + Math.sin(now * 0.0053 + i * 0.4) * a * 0.5;
          y += Math.cos(now * 0.0019 + i * 1.3) * a + Math.cos(now * 0.0047 + i * 0.9) * a * 0.5;
        }
        pts.push([x, y]);
      }
      let dx = 0;
      let dy = 0;
      let rot = 0;
      let sc = 1;
      if (!isStill && o.mode === 'track') {
        dx = Math.sin(now / 1900) * 4;
        dy = Math.cos(now / 2600) * 3;
        rot = Math.sin(now / 3100) * 4;
      }
      if (!isStill && o.mode === 'hero') {
        sc = 1 + Math.sin(now / 1800) * 0.015;
        rot = Math.sin(now / 4200) * 2;
      }
      const cr = Math.cos((rot * Math.PI) / 180);
      const sr = Math.sin((rot * Math.PI) / 180);
      for (const p of pts) {
        const ux = (p[0] - 50) * sc;
        const uy = (p[1] - 55) * sc;
        p[0] = 50 + ux * cr - uy * sr + dx;
        p[1] = 55 + ux * sr + uy * cr + dy;
      }
      const ti = isStill ? 1e9 : now - intro;
      const sw = o.mode === 'mark' ? 3 : o.mode === 'hero' ? 1.1 : 1.3;
      const rs = o.mode === 'mark' ? 1 : o.mode === 'hero' ? 0.62 : 0.7;
      BONES.forEach(([a, b], j) => {
        const l = lines[j];
        const p = pts[a] ?? ORIGIN;
        const q = pts[b] ?? ORIGIN;
        const g = 1 - Math.pow(1 - clamp((ti - 300 - j * 45) / 600), 3);
        set(l, 'x1', p[0]);
        set(l, 'y1', p[1]);
        set(l, 'x2', p[0] + (q[0] - p[0]) * g);
        set(l, 'y2', p[1] + (q[1] - p[1]) * g);
        set(l, 'stroke-width', sw);
        set(l, 'stroke-opacity', o.mode === 'mark' ? 0.42 : 0.5);
      });
      pts.forEach((p, i) => {
        const tip = TIPS.includes(i);
        const f = clamp((ti - i * 45) / 450);
        const s = f === 0 ? 0 : 1 + 2.70158 * Math.pow(f - 1, 3) + 1.70158 * Math.pow(f - 1, 2);
        let r = (tip ? 5.2 : i === 0 ? 4.6 : 3.4) * rs * s;
        if (tip && o.mode === 'mark' && !isStill && ti > 1600) {
          r *= 1 + Math.max(0, Math.sin((now / 2800) * Math.PI * 2 - i * 0.27)) * 0.4;
        }
        const c = dots[i];
        set(c, 'cx', p[0]);
        set(c, 'cy', p[1]);
        set(c, 'r', Math.max(0, r));
      });
      const showRings = o.mode !== 'mark' && !isStill;
      rings.forEach((c, k) => {
        if (!showRings || ti < 1200) {
          set(c, 'r', 0);
          return;
        }
        const ph = ((now / 1000) * 0.5 + k * 0.2) % 1;
        const p = pts[TIPS[k] ?? 0] ?? ORIGIN;
        set(c, 'cx', p[0]);
        set(c, 'cy', p[1]);
        set(c, 'r', 5.2 * rs + ph * 9);
        set(c, 'stroke-opacity', (1 - ph) * 0.9);
      });
      if (gLabels) gLabels.style.display = o.labels ? '' : 'none';
      if (o.labels) {
        pts.forEach((p, i) => {
          const t = nums[i];
          set(t, 'x', p[0] + 3.2);
          set(t, 'y', p[1] - 2.6);
          if (t) t.style.opacity = ti > i * 45 + 200 ? '1' : '0';
        });
      }
      const showBox = o.mode === 'track';
      if (gBox) gBox.style.display = showBox ? '' : 'none';
      if (showBox) {
        let x0 = 1e9;
        let y0 = 1e9;
        let x1 = -1e9;
        let y1 = -1e9;
        for (const p of pts) {
          x0 = Math.min(x0, p[0]);
          y0 = Math.min(y0, p[1]);
          x1 = Math.max(x1, p[0]);
          y1 = Math.max(y1, p[1]);
        }
        x0 -= 7;
        y0 -= 7;
        x1 += 7;
        y1 += 7;
        const L = 6;
        const d = [
          `M${x0} ${y0 + L}V${y0}H${x0 + L}`,
          `M${x1 - L} ${y0}H${x1}V${y0 + L}`,
          `M${x1} ${y1 - L}V${y1}H${x1 - L}`,
          `M${x0 + L} ${y1}H${x0}V${y1 - L}`,
        ];
        box.forEach((path, i) => {
          set(path, 'd', d[i] ?? '');
        });
        set(boxText ?? undefined, 'x', x0);
        set(boxText ?? undefined, 'y', y0 - 2.5);
        if (boxText) boxText.textContent = o.tag ?? 'HAND · 21 PTS';
      }
    };

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (visible) frame(now);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      host?.removeEventListener('mouseenter', replay);
      handle.go = undefined;
    };
  }, [replayOnHover]);

  return (
    <svg
      ref={svg}
      className={`live-hand mode-${mode} ${className}`}
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
    >
      <g className="lv-box" fill="none" strokeWidth={0.8}>
        {[0, 1, 2, 3].map((i) => (
          <path key={i} className="lv-corner" />
        ))}
        <text className="lv-tag" fontSize={2.8} />
      </g>
      <g stroke="currentColor" strokeLinecap="round">
        {BONES.map((_, i) => (
          <line key={i} className="lv-bone" />
        ))}
      </g>
      <g className="lv-rings" fill="none" strokeWidth={0.6}>
        {TIPS.map((i) => (
          <circle key={i} className="lv-ring" r={0} />
        ))}
      </g>
      <g>
        {OPEN.map((_, i) => (
          <circle key={i} className={`lv-joint ${TIPS.includes(i) ? 'tip' : ''}`} r={0} />
        ))}
      </g>
      <g className="lv-labels" fontSize={2.7}>
        {OPEN.map((_, i) => (
          <text key={i} className={`lv-num ${TIPS.includes(i) ? 'tip' : ''}`}>
            {i}
          </text>
        ))}
      </g>
    </svg>
  );
}
