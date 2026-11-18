import { useEffect, useRef, useState, type RefObject } from 'react';
import { TrackerClient } from '../ml/tracker-client';
import { drawLandmarks } from '../lib/overlay';
import { useLocale } from '../locale';
export function CloudSkeleton({
  video,
  active,
  mirror,
}: {
  video: RefObject<HTMLVideoElement | null>;
  active: boolean;
  mirror: boolean;
}) {
  const { t } = useLocale();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!active) return;
    let gone = false;
    let tracker: TrackerClient | null = null;
    void TrackerClient.create('hands_pose_lips')
      .then((client) => {
        if (gone || !video.current) {
          client.dispose();
          return;
        }
        tracker = client;
        setStatus('ready');
        client.start(video.current, ({ frame }) => {
          const c = canvas.current;
          const v = video.current;
          if (!c || !v) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.round(c.clientWidth * ratio),
            height = Math.round(c.clientHeight * ratio);
          if (c.width !== width || c.height !== height) {
            c.width = width;
            c.height = height;
          }
          const ctx = c.getContext('2d');
          if (ctx) drawLandmarks(ctx, frame, undefined, { aspect: v.videoWidth / v.videoHeight });
        });
      })
      .catch(() => {
        if (!gone) setStatus('error');
      });
    return () => {
      gone = true;
      tracker?.dispose();
    };
  }, [active, video]);
  if (!active) return null;
  return (
    <>
      <canvas
        ref={canvas}
        className={`cloud-skeleton ${mirror ? 'mirrored' : ''}`}
        role="img"
        aria-label={t('Скелет рук и тела на устройстве', 'Құрылғыдағы қол мен дене қаңқасы')}
      />
      <span className="skeleton-status" role="status">
        {status === 'loading'
          ? t('Подключаем скелет…', 'Қаңқа қосылуда…')
          : status === 'error'
            ? t(
                'Скелет недоступен. Видео можно распознать.',
                'Қаңқа қолжетімсіз. Бейнені тануға болады.',
              )
            : t('Скелет · на устройстве', 'Қаңқа · құрылғыда')}
      </span>
    </>
  );
}
