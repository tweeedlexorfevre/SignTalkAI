import { useEffect, useRef } from 'react';
import { motionReduced } from './motion';

/**
 * A field of tracking points behind a surface. Dots near the pointer grow and
 * the closest light up in the signal colour. The dot colour is the element's
 * CSS `color`, so it follows the theme.
 */
export function DotField({
  gap = 22,
  alpha = 0.13,
  className = '',
}: {
  gap?: number;
  alpha?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let w = 0;
    let h = 0;
    let ink = '22,19,14';
    const signal = '255,90,31';
    let px = -1e4;
    let py = -1e4;
    let visible = true;
    const rgb = (value: string, fallback: string) => {
      const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(value);
      return m ? `${m[1]},${m[2]},${m[3]}` : fallback;
    };
    const size = () => {
      const r = el.getBoundingClientRect();
      const d = Math.min(2, devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      el.width = Math.max(1, Math.round(w * d));
      el.height = Math.max(1, Math.round(h * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const style = getComputedStyle(el);
      ink = rgb(style.color, ink);
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
    });
    io.observe(el);
    const move = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
    };
    window.addEventListener('pointermove', move, { passive: true });

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const r = el.getBoundingClientRect();
      const lx = px - r.left;
      const ly = py - r.top;
      const still = motionReduced();
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const b = Math.max(0, 1 - Math.hypot(x - lx, y - ly) / 160);
          const wave = still ? 0.5 : (Math.sin((x * 0.7 + y) / 90 - now * 0.0011) + 1) / 2;
          ctx.fillStyle =
            b > 0.62
              ? `rgba(${signal},${Math.min(1, 0.35 + b)})`
              : `rgba(${ink},${Math.min(1, alpha * (0.55 + 0.9 * wave) + b * 0.6)})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.1 + b * 2 + wave * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || !w) return;
      // Reduced motion: redraw only when the pointer moves (cheap enough either way).
      if (motionReduced() && now - last < 120) return;
      // Follow theme / contrast changes without a resize.
      if (Math.floor(now / 1000) !== Math.floor(last / 1000))
        ink = rgb(getComputedStyle(el).color, ink);
      last = now;
      draw(now);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', move);
    };
  }, [gap, alpha]);

  return <canvas ref={canvas} className={`dot-field ${className}`} aria-hidden />;
}
