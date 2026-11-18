import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, CircleDot, Cloud, Upload, X, ArrowRight, RotateCcw } from 'lucide-react';
import { useLocale, tr } from '../locale';
import type { Locale } from '../locale';
import { openCamera, stopStream, CAMERA_MESSAGES, classifyCameraError } from '../lib/camera';
import { cloudMessage, requestCloud, type CloudResult, type SignLanguage } from './client';
import { Button } from '../components/ui';
import { useRecognitionPreferences } from '../recognition/preferences';
import { CloudSkeleton } from '../recognition/CloudSkeleton';

export function CloudPanel({
  language,
  output,
  model,
  onPick,
  composer,
}: {
  language: SignLanguage;
  output: Locale;
  model: string;
  onPick: (text: string) => void;
  composer: ReactNode;
}) {
  const { lang, t } = useLocale();
  const prefs = useRecognitionPreferences();
  const vocabulary = language === 'krsl' ? prefs.vocabulary : 'free';
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const upload = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<
    'idle' | 'starting' | 'countdown' | 'recording' | 'ready' | 'sending'
  >('idle');
  const [count, setCount] = useState(3);
  const [consent, setConsent] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CloudResult | null>(null);
  const updateClip = (blob: Blob | null) => {
    setClip(blob);
    setPreview(blob ? URL.createObjectURL(blob) : '');
    setConsent(false);
  };
  const release = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = recorder.current;
    recorder.current = null;
    if (r) {
      r.onstop = null;
      r.ondataavailable = null;
      r.onerror = null;
      if (r.state !== 'inactive') r.stop();
    }
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  const cancel = () => {
    generation.current++;
    controller.current?.abort();
    release();
    setPhase(clip ? 'ready' : 'idle');
  };
  useEffect(() => {
    const stop = () => {
      generation.current++;
      controller.current?.abort();
      release();
      setPhase((previous) => (previous === 'ready' || previous === 'sending' ? 'ready' : 'idle'));
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, []);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  const capture = async () => {
    if (typeof MediaRecorder === 'undefined') {
      setError(
        t(
          'Запись не поддерживается. Загрузите короткое видео.',
          'Жазу қолдау көрсетілмейді. Қысқа бейне жүктеңіз.',
        ),
      );
      return;
    }
    const ticket = ++generation.current;
    setError('');
    setResult(null);
    updateClip(null);
    setPhase('starting');
    try {
      const source = await openCamera();
      if (ticket !== generation.current) {
        stopStream(source);
        return;
      }
      stream.current = source;
      if (!video.current) {
        release();
        return;
      }
      video.current.srcObject = source;
      await video.current.play();
      if (ticket !== generation.current) return;
      const tick = (n: number) => {
        if (ticket !== generation.current) return;
        setCount(n);
        setPhase('countdown');
        if (n > 0) {
          timer.current = setTimeout(() => {
            tick(n - 1);
          }, 1000);
          return;
        }
        try {
          const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'].find((m) =>
            MediaRecorder.isTypeSupported(m),
          );
          const r = new MediaRecorder(source, {
            ...(mime ? { mimeType: mime } : {}),
            videoBitsPerSecond: 1600000,
          });
          recorder.current = r;
          const chunks: Blob[] = [];
          r.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          r.onerror = () => {
            if (ticket === generation.current) {
              release();
              setPhase('idle');
              setError(t('Не удалось записать видео.', 'Бейнені жазу мүмкін болмады.'));
            }
          };
          r.onstop = () => {
            if (ticket !== generation.current) return;
            const blob = new Blob(chunks, { type: r.mimeType });
            release();
            updateClip(blob);
            setPhase('ready');
          };
          r.start();
          setPhase('recording');
          timer.current = setTimeout(() => {
            if (r.state === 'recording') r.stop();
          }, prefs.cloudSeconds * 1000);
        } catch {
          release();
          setPhase('idle');
          setError(
            t(
              'Не удалось записать видео. Попробуйте загрузить файл.',
              'Бейнені жазу мүмкін болмады. Файл жүктеп көріңіз.',
            ),
          );
        }
      };
      tick(prefs.countdown);
    } catch (e) {
      if (ticket === generation.current) {
        release();
        setPhase('idle');
        setError(tr(CAMERA_MESSAGES[classifyCameraError(e)].title));
      }
    }
  };
  const send = async () => {
    if (!clip || !consent) return;
    const ticket = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPhase('sending');
    setError('');
    setResult(null);
    try {
      const value = await requestCloud(clip, language, output, model, abort.signal, vocabulary);
      if (ticket === generation.current) {
        setResult(value);
        setPhase('ready');
      }
    } catch (e) {
      if (ticket === generation.current) {
        setPhase('ready');
        setError(cloudMessage(e instanceof Error ? e.message : 'network', lang));
      }
    }
  };
  const busy = ['starting', 'countdown', 'recording', 'sending'].includes(phase);
  return (
    <div className="native-grid cloud-workspace">
      <section className="capture-panel" aria-label={t('Камера и запись', 'Камера және жазу')}>
        <div className="panel-topline">
          <span>
            <Camera size={17} aria-hidden />
            {t('Ваш жест', 'Сіздің ымыңыз')}
          </span>
          <span className="subtle-tag">
            <Cloud size={13} aria-hidden />
            {model.replace('gemini-', 'Gemini ')}
          </span>
        </div>
        <div className="cloud-camera">
          <video
            ref={video}
            muted
            playsInline
            className={`${prefs.mirror ? 'mirrored' : ''} ${['starting', 'countdown', 'recording'].includes(phase) ? '' : 'invisible'}`}
            aria-label={t('Видео с камеры', 'Камера видеосы')}
          />
          {prefs.showSkeleton && (phase === 'countdown' || phase === 'recording') ? (
            <CloudSkeleton video={video} active mirror={prefs.mirror} />
          ) : null}
          {clip && preview && !['starting', 'countdown', 'recording'].includes(phase) ? (
            <video
              src={preview}
              controls
              playsInline
              aria-label={t('Просмотр записи', 'Жазбаны көру')}
            />
          ) : null}
          {phase === 'idle' || phase === 'starting' ? (
            <div className="cloud-camera-empty">
              <div className="camera-symbol">
                <Camera size={32} strokeWidth={1.4} aria-hidden />
              </div>
              <h2>{t('Покажите, что хотите сказать', 'Айтқыңыз келгенді көрсетіңіз')}</h2>
              <p>
                {t(
                  'Расположите лицо и обе руки в кадре.',
                  'Бетіңіз бен екі қолыңыз кадрда болсын.',
                )}
              </p>
              <Button
                variant="primary"
                size="lg"
                disabled={phase === 'starting'}
                onClick={() => {
                  void capture();
                }}
              >
                <CircleDot size={18} aria-hidden />
                {phase === 'starting'
                  ? t('Подключение…', 'Қосылуда…')
                  : t('Записать жест', 'Ымды жазу')}
              </Button>
            </div>
          ) : null}
          {phase === 'countdown' ? (
            <div className="countdown-overlay" role="status">
              <b>{count}</b>
              <span>{t('Приготовьтесь', 'Дайындалыңыз')}</span>
            </div>
          ) : null}
          {phase === 'recording' ? (
            <div className="recording-indicator" role="status">
              <span />
              {t(
                `Показывайте жест · ${prefs.cloudSeconds} сек.`,
                `Ымды көрсетіңіз · ${prefs.cloudSeconds} сек.`,
              )}
            </div>
          ) : null}
        </div>
        <div className="camera-actions">
          {busy ? (
            <Button onClick={cancel}>
              <X size={16} aria-hidden />
              {t('Отменить', 'Бас тарту')}
            </Button>
          ) : (
            <>
              {clip ? (
                <Button
                  onClick={() => {
                    void capture();
                  }}
                >
                  <RotateCcw size={16} aria-hidden />
                  {t('Переснять', 'Қайта түсіру')}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => upload.current?.click()}>
                <Upload size={16} aria-hidden />
                {t('Загрузить видео', 'Бейне жүктеу')}
              </Button>
            </>
          )}
          <input
            ref={upload}
            type="file"
            accept="video/webm,video/mp4"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (
                file.size > 12 * 1024 * 1024 ||
                !['video/webm', 'video/mp4'].includes(file.type)
              ) {
                setError(cloudMessage('file_too_large', lang));
                return;
              }
              const probe = document.createElement('video');
              const url = URL.createObjectURL(file);
              const ticket = ++generation.current;
              probe.onloadedmetadata = () => {
                URL.revokeObjectURL(url);
                if (ticket !== generation.current) return;
                if (!Number.isFinite(probe.duration) || probe.duration > 15) {
                  setError(cloudMessage('file_too_large', lang));
                  return;
                }
                updateClip(file);
                setResult(null);
                setError('');
                setPhase('ready');
              };
              probe.onerror = () => {
                URL.revokeObjectURL(url);
                if (ticket === generation.current) setError(cloudMessage('invalid_video', lang));
              };
              probe.src = url;
            }}
          />
        </div>
        {clip ? (
          <div className="cloud-send">
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  if (!e.target.checked && phase === 'sending') cancel();
                }}
              />
              {t(
                'Разрешаю отправить это видео Google для распознавания.',
                'Осы бейнені тану үшін Google-ға жіберуге келісемін.',
              )}
            </label>
            <Button
              variant="primary"
              size="lg"
              disabled={!consent || busy}
              onClick={() => {
                void send();
              }}
            >
              <Cloud size={18} aria-hidden />
              {phase === 'sending'
                ? t('Распознаём…', 'Тануда…')
                : t('Распознать видео', 'Бейнені тану')}
            </Button>
            <p className="model-note">
              {t(
                'Камера записывается без звука. Загруженное видео может содержать звук.',
                'Камера дыбыссыз жазылады. Жүктелген бейнеде дыбыс болуы мүмкін.',
              )}
            </p>
          </div>
        ) : (
          <p className="camera-footnote">
            {t(
              'Запись начнётся после отсчёта. Отправка — только с вашего разрешения.',
              'Жазу кері санаудан кейін басталады. Жіберу тек сіздің рұқсатыңызбен.',
            )}
          </p>
        )}
        <p className="cloud-status" role="status">
          {phase === 'sending'
            ? t(
                'Анализируем движение. Обычно это занимает несколько секунд.',
                'Қимылды талдаудамыз. Әдетте бірнеше секунд қажет.',
              )
            : ''}
        </p>
        <p className="model-note">
          {vocabulary === 'krsl10'
            ? t(
                'Словарь KRSL · 10 жестов. Названия совпадают с примерами и локальной моделью. Незнакомый жест может остаться нераспознанным.',
                'KRSL сөздігі · 10 ым. Атаулар мысалдар мен жергілікті модельге сәйкес. Бейтаныс ым танылмауы мүмкін.',
              )
            : t(
                'Свободное распознавание · эксперимент. Результат не ограничен словарём примеров.',
                'Еркін тану · тәжірибе. Нәтиже мысалдар сөздігімен шектелмейді.',
              )}
        </p>
        {error ? (
          <p role="alert" className="error-box">
            {error}
          </p>
        ) : null}
      </section>
      <div className="message-column">
        {result ? (
          <div className="cloud-result" aria-live="polite">
            <span className="field-label">
              {result.vocabulary === 'krsl10'
                ? t(
                    'Гипотеза по словарю · проверьте результат',
                    'Сөздік бойынша болжам · нәтижені тексеріңіз',
                  )
                : t('Вариант ИИ · проверьте смысл', 'ЖИ нұсқасы · мағынасын тексеріңіз')}
            </span>
            {result.status === 'recognized' ? (
              <>
                <p>{result.text}</p>
                <Button
                  onClick={() => {
                    onPick(result.text);
                  }}
                >
                  {t('В сообщение', 'Хабарламаға')}
                  <ArrowRight size={16} aria-hidden />
                </Button>
              </>
            ) : (
              <p>
                {t(
                  'Жест не удалось понять. Попробуйте ещё раз или напишите текст.',
                  'Ымды түсіну мүмкін болмады. Қайталап көріңіз немесе мәтін жазыңыз.',
                )}
              </p>
            )}
          </div>
        ) : null}
        {composer}
      </div>
    </div>
  );
}
