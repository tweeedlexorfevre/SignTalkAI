import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Camera, CircleDot, Square, X } from 'lucide-react';
import { tr, useLocale } from '../locale';
import { CAMERA_MESSAGES, classifyCameraError, openCamera, stopStream } from '../lib/camera';
import { Button } from '../components/ui';
import { useRecognitionPreferences } from '../recognition/preferences';
import {
  lipreadMessage,
  lipreadStatus,
  recognizeLips,
  type LipreadResult,
  type LipreadStatus,
} from './client';
import words from './words.json';

const MAX_SECONDS = 15;
const GROUPS: Record<string, [string, string]> = {
  polite: ['Вежливость и ответы', 'Сыпайылық және жауаптар'],
  needs: ['Помощь и здоровье', 'Көмек және денсаулық'],
  questions: ['Вопросы', 'Сұрақтар'],
  people: ['Люди', 'Адамдар'],
  life: ['Учёба и быт', 'Оқу және тұрмыс'],
  time: ['Время', 'Уақыт'],
  talk: ['Разговор', 'Сөйлесу'],
};

/** Lip reading: record yourself mouthing a phrase, the local Auto-AVSR service returns English text. */
export function LipReadPanel({
  onPick,
  composer,
}: {
  onPick: (text: string) => void;
  composer: ReactNode;
}) {
  const { lang, t } = useLocale();
  const prefs = useRecognitionPreferences();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live' | 'recording' | 'sending'>(
    'idle',
  );
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<LipreadStatus | null>(null);
  const [results, setResults] = useState<LipreadResult[]>([]);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const value = await lipreadStatus();
      if (!alive) return;
      setStatus(value);
      if (!value.ready) poll = setTimeout(() => void check(), 3000);
    };
    void check();
    return () => {
      alive = false;
      if (poll) clearTimeout(poll);
    };
  }, []);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const closeCamera = () => {
    stopTimer();
    const r = recorder.current;
    recorder.current = null;
    if (r) {
      r.ondataavailable = null;
      r.onstop = null;
      if (r.state !== 'inactive') r.stop();
    }
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        controller.current?.abort();
        closeCamera();
        setPhase('idle');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      controller.current?.abort();
      closeCamera();
    };
    // closeCamera only touches refs, so the mount-time copy stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError('');
    setPhase('starting');
    try {
      const source = await openCamera();
      stream.current = source;
      if (video.current) {
        video.current.srcObject = source;
        await video.current.play();
      }
      setPhase('live');
    } catch (e) {
      closeCamera();
      setPhase('idle');
      setError(tr(CAMERA_MESSAGES[classifyCameraError(e)].title));
    }
  };

  const send = async (clip: Blob) => {
    const abort = new AbortController();
    controller.current = abort;
    setPhase('sending');
    try {
      const value = await recognizeLips(clip, abort.signal);
      setResults((list) => [value, ...list].slice(0, 8));
    } catch (e) {
      if (!abort.signal.aborted)
        setError(lipreadMessage(e instanceof Error ? e.message : '', lang));
    } finally {
      if (stream.current) setPhase('live');
    }
  };

  const record = () => {
    const source = stream.current;
    if (!source || typeof MediaRecorder === 'undefined') return;
    setError('');
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
      (m) => MediaRecorder.isTypeSupported(m),
    );
    const r = new MediaRecorder(source, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 2500000,
    });
    recorder.current = r;
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      stopTimer();
      recorder.current = null;
      void send(new Blob(chunks, { type: r.mimeType }));
    };
    r.start();
    setElapsed(0);
    setPhase('recording');
    const began = Date.now();
    timer.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - began) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS && r.state === 'recording') r.stop();
    }, 250);
  };
  const finish = () => {
    const r = recorder.current;
    if (r && r.state === 'recording') r.stop();
  };

  const ready = status?.ready === true;
  const cameraOn = phase === 'live' || phase === 'recording' || phase === 'sending';
  return (
    <div className="native-grid cloud-workspace lipread-workspace">
      <section className="capture-panel" aria-label={t('Камера и запись', 'Камера және жазу')}>
        <div className="panel-topline">
          <span>
            <Camera size={17} aria-hidden />
            {t('Чтение по губам', 'Ерін оқу')}
          </span>
          <span className="subtle-tag">Auto-AVSR · English</span>
        </div>
        <p className="lipread-status" role="status">
          {status === null
            ? t('Проверяем сервис…', 'Қызметті тексерудеміз…')
            : !status.online
              ? lipreadMessage('lipread_offline', lang)
              : status.error
                ? t(`Модель не загрузилась: ${status.error}`, `Модель жүктелмеді: ${status.error}`)
                : !status.ready
                  ? lipreadMessage('lipread_loading', lang)
                  : t(
                      `Модель готова · обработка на этом компьютере (${status.device ?? 'cpu'})`,
                      `Модель дайын · өңдеу осы компьютерде (${status.device ?? 'cpu'})`,
                    )}
        </p>
        <div className="cloud-camera">
          <video
            ref={video}
            muted
            playsInline
            className={`${prefs.mirror ? 'mirrored' : ''} ${cameraOn ? '' : 'invisible'}`}
            aria-label={t('Видео с камеры', 'Камера видеосы')}
          />
          {cameraOn ? <div className="lip-guide" aria-hidden /> : null}
          {!cameraOn ? (
            <div className="cloud-camera-empty">
              <div className="camera-symbol">
                <Camera size={32} strokeWidth={1.4} aria-hidden />
              </div>
              <h2>{t('Говорите губами — без звука', 'Ерінмен сөйлеңіз — дыбыссыз')}</h2>
              <p>
                {t(
                  'Лицо прямо в камеру, рот хорошо освещён. Пока модель понимает только английский.',
                  'Бетіңіз камераға тура, ауызыңыз жақсы жарықтандырылсын. Әзірге модель тек ағылшынша түсінеді.',
                )}
              </p>
              <Button
                variant="primary"
                size="lg"
                disabled={phase === 'starting'}
                onClick={() => {
                  void start();
                }}
              >
                <Camera size={18} aria-hidden />
                {phase === 'starting'
                  ? t('Подключение…', 'Қосылуда…')
                  : t('Включить камеру', 'Камераны қосу')}
              </Button>
            </div>
          ) : null}
          {phase === 'recording' ? (
            <div className="recording-indicator" role="status">
              <span />
              {t(
                `Запись · ${elapsed} / ${MAX_SECONDS} сек.`,
                `Жазу · ${elapsed} / ${MAX_SECONDS} сек.`,
              )}
            </div>
          ) : null}
        </div>
        <div className="camera-actions">
          {phase === 'live' ? (
            <Button variant="primary" size="lg" disabled={!ready} onClick={record}>
              <CircleDot size={18} aria-hidden />
              {t('Начать запись', 'Жазуды бастау')}
            </Button>
          ) : null}
          {phase === 'recording' ? (
            <Button variant="primary" size="lg" onClick={finish}>
              <Square size={16} aria-hidden />
              {t('Стоп и распознать', 'Тоқтату және тану')}
            </Button>
          ) : null}
          {phase === 'sending' ? (
            <Button variant="primary" size="lg" disabled>
              {t('Распознаём…', 'Тануда…')}
            </Button>
          ) : null}
          {cameraOn ? (
            <Button
              variant="ghost"
              onClick={() => {
                controller.current?.abort();
                closeCamera();
                setPhase('idle');
              }}
            >
              <X size={16} aria-hidden />
              {t('Выключить камеру', 'Камераны өшіру')}
            </Button>
          ) : null}
        </div>
        <p className="camera-footnote">
          {t(
            'Нажмите «Начать запись», произнесите фразу губами и нажмите «Стоп». Видео не уходит в интернет: его обрабатывает сервис на этом компьютере.',
            '«Жазуды бастау» басып, фразаны ерінмен айтып, «Тоқтату» басыңыз. Бейне интернетке жіберілмейді: оны осы компьютердегі қызмет өңдейді.',
          )}
        </p>
        {error ? (
          <p role="alert" className="error-box">
            {error}
          </p>
        ) : null}
      </section>
      <div className="message-column">
        {results.length ? (
          <div className="cloud-result" aria-live="polite">
            <span className="field-label">
              {t('Прочитано по губам · проверьте смысл', 'Еріннен оқылды · мағынасын тексеріңіз')}
            </span>
            <ol className="lipread-results">
              {results.map((item, index) => (
                <li key={`${index}-${item.text}`}>
                  <p>{item.text || t('(ничего не распознано)', '(ештеңе танылмады)')}</p>
                  <small>{t(`${item.seconds} сек.`, `${item.seconds} сек.`)}</small>
                  {item.text ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        onPick(item.text);
                      }}
                    >
                      {t('В сообщение', 'Хабарламаға')}
                      <ArrowRight size={14} aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {composer}
        <details className="content-card lipread-words">
          <summary>
            {t(
              `Словарь для чтения по губам RU/KZ · ${words.length} слов`,
              `Ерін оқуға арналған RU/KZ сөздігі · ${words.length} сөз`,
            )}
          </summary>
          <p className="model-note">
            {t(
              'Эти слова мы выбрали для будущей модели на русском и казахском. Сейчас модель понимает только английский: колонка EN подходит для проверки.',
              'Бұл сөздерді орыс және қазақ тілдеріндегі болашақ модель үшін таңдадық. Қазір модель тек ағылшынша түсінеді: EN бағаны тексеруге жарайды.',
            )}
          </p>
          {Object.entries(GROUPS).map(([group, title]) => (
            <div key={group} className="lipread-group">
              <h3>{lang === 'kk' ? title[1] : title[0]}</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">RU</th>
                    <th scope="col">KZ</th>
                    <th scope="col">EN</th>
                  </tr>
                </thead>
                <tbody>
                  {words
                    .filter((w) => w.group === group)
                    .map((w) => (
                      <tr key={w.id}>
                        <td>{w.ru}</td>
                        <td>{w.kk}</td>
                        <td>{w.en}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </details>
      </div>
    </div>
  );
}
