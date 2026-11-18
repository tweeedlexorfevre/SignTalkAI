import { useEffect, useRef } from 'react';
import { drawPreview, type TakePreview } from './preview';

/** Looping skeleton animation of one recorded take. */
export function TakePreviewCanvas({
  preview,
  label,
  playing = true,
}: {
  preview: TakePreview;
  label: string;
  playing?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const style = getComputedStyle(canvas);
    const colors = {
      body: style.getPropertyValue('--stage-ink').trim() || '#f2ede4',
      left: style.getPropertyValue('--signal').trim() || '#ff5a1f',
      right: '#5ec8a8',
      joint: style.getPropertyValue('--stage-ink').trim() || '#f2ede4',
    };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let frame = 0;
    const draw = () => {
      drawPreview(ctx, preview, frame, colors);
    };
    draw();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!playing || reduce || preview.frames.length < 2) return;
    // Hold the last frame for a moment before looping, so the end shape is readable.
    const step = 1000 / preview.fps;
    const total = preview.frames.length + Math.round(600 / step);
    const id = window.setInterval(() => {
      frame = (frame + 1) % total;
      if (frame < preview.frames.length) draw();
    }, step);
    return () => {
      window.clearInterval(id);
    };
  }, [preview, playing]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="block aspect-[4/3] w-full rounded-lg"
      style={{ background: 'var(--stage)' }}
    />
  );
}
