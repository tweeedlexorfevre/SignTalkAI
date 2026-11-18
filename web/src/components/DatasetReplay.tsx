import { useEffect, useRef, useState } from 'react';
import type { DatasetSample } from '../dataset/schema';
import { HAND_CONNECTIONS } from '../ml/landmarks';
import { useLocale } from '../locale';
import { Button } from './ui';

/** Review only the saved hand coordinates; this never pretends to be video. */
export function DatasetReplay({ sample }: { sample: DatasetSample }) {
  const { t } = useLocale();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const draw = () => {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      const elapsed = playing ? Math.min(sample.durationMs, performance.now() - start) : 0;
      const frame = sample.frames.findLast((f) => f.tMs <= elapsed) ?? sample.frames[0];
      ctx.clearRect(0, 0, 480, 360);
      for (const [index, hand] of [frame?.left, frame?.right].entries()) {
        if (!hand) continue;
        ctx.fillStyle = ctx.strokeStyle = index === 0 ? '#67e8f9' : '#fde68a';
        ctx.lineWidth = 2;
        for (const [a, b] of HAND_CONNECTIONS) {
          const p = hand[a];
          const q = hand[b];
          if (!p || !q) continue;
          ctx.beginPath();
          ctx.moveTo((1 - p[0]) * 480, p[1] * 360);
          ctx.lineTo((1 - q[0]) * 480, q[1] * 360);
          ctx.stroke();
        }
        for (const p of hand) {
          if (!p) continue;
          ctx.beginPath();
          ctx.arc((1 - p[0]) * 480, p[1] * 360, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (playing && elapsed < sample.durationMs) raf = requestAnimationFrame(draw);
      else if (playing) setPlaying(false);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, sample]);
  return (
    <div className="dataset-replay">
      <canvas
        ref={canvas}
        width={480}
        height={360}
        role="img"
        aria-label={t(
          'Записанные координаты рук, без видео',
          'Жазылған қол координаттары, бейнесіз',
        )}
      />
      <Button
        disabled={!sample.frames.length}
        onClick={() => {
          setPlaying(!playing);
        }}
      >
        {playing
          ? t('Остановить просмотр', 'Көруді тоқтату')
          : t('Проиграть координаты', 'Координаттарды ойнату')}
      </Button>
    </div>
  );
}
