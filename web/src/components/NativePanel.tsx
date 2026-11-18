import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Camera, Square, CircleDot } from 'lucide-react';
import type { Session } from '../app/session';
import { openCamera, stopStream, CAMERA_MESSAGES, classifyCameraError } from '../lib/camera';
import { useLocale, tr, type Locale } from '../locale';
import { handsFromFrame, krslFeatures } from '../ml/krsl-features';
import {
  LocalModel,
  putRgbFrame,
  type LocalGuess,
  type LocalLabel,
  type LocalKind,
  type LocalMeta,
} from '../ml/local-model';
import { Stage } from './Stage';
import { Button, Card } from './ui';
import { useRecognitionPreferences } from '../recognition/preferences';

export function NativePanel({
  kind,
  session,
  output,
  onPick,
  composer,
  samplesOnly = false,
}: {
  kind: LocalKind;
  session: Session;
  output: Locale;
  onPick: (text: string) => void;
  composer?: ReactNode;
  samplesOnly?: boolean;
}) {
  const { t } = useLocale();
  const prefs = useRecognitionPreferences();
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [model, setModel] = useState<{ labels: LocalLabel[]; meta: LocalMeta } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'recording' | 'running'>('idle');
  const [count, setCount] = useState(0);
  const [guesses, setGuesses] = useState<LocalGuess[]>([]);
  const [empty, setEmpty] = useState(false);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [sampleLabel, setSampleLabel] = useState<{ ru: string; kk: string } | null>(null);
  const client = useRef<LocalModel | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const epoch = useRef(0);
  const tokens = useRef<number[][][]>([]);
  const recording = useRef(false);
  const cameraOperation = useRef(false);
  const timeouts = useRef(new Map<ReturnType<typeof setTimeout>, () => void>());
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(() => {
        timeouts.current.delete(id);
        resolve();
      }, ms);
      timeouts.current.set(id, resolve);
    });
  const stop = () => {
    cameraOperation.current = false;
    epoch.current++;
    recording.current = false;
    tokens.current = [];
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    session.stopCamera();
    setLive(false);
    setStarting(false);
    setPhase('idle');
    for (const [id, resolve] of timeouts.current) {
      clearTimeout(id);
      resolve();
    }
    timeouts.current.clear();
  };
  useEffect(() => {
    let gone = false;
    const m = new LocalModel();
    client.current = m;
    m.load(kind)
      .then((v) => {
        if (!gone) setModel(v);
      })
      .catch((e: unknown) => {
        if (!gone) setError(String(e));
      });
    return () => {
      gone = true;
      client.current = null;
      m.dispose();
    };
  }, [kind, attempt]);
  useEffect(
    () =>
      session.onFrame((frame, source) => {
        if (recording.current && source === 'camera') tokens.current.push(...handsFromFrame(frame));
      }),
    [session],
  );
  useEffect(
    () =>
      session.subscribe(() => {
        if (
          kind === 'krsl' &&
          session.getSnapshot().source !== 'camera' &&
          cameraOperation.current
        ) {
          cameraOperation.current = false;
          epoch.current++;
          recording.current = false;
          tokens.current = [];
          setPhase('idle');
          for (const [id, resolve] of timeouts.current) {
            clearTimeout(id);
            resolve();
          }
          timeouts.current.clear();
        }
      }),
    [kind, session],
  );
  useEffect(() => {
    const timers = timeouts.current;
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        epoch.current++;
        recording.current = false;
        stopStream(stream.current);
        stream.current = null;
        if (video.current) video.current.srcObject = null;
        session.stopCamera();
        setLive(false);
        setStarting(false);
        setPhase('idle');
      }
    };
    document.addEventListener('visibilitychange', hide);
    const leave = () => {
      epoch.current++;
      recording.current = false;
      stopStream(stream.current);
      stream.current = null;
    };
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      leave();
      session.stopCamera();
      for (const [id, resolve] of timers) {
        clearTimeout(id);
        resolve();
      }
      timers.clear();
    };
  }, [session]);
  const start = async () => {
    const ticket = ++epoch.current;
    setError('');
    setStarting(true);
    try {
      const s = await openCamera();
      if (ticket !== epoch.current) {
        stopStream(s);
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      if (ticket !== epoch.current) return;
      setLive(true);
    } catch (e) {
      if (ticket === epoch.current) {
        stopStream(stream.current);
        stream.current = null;
        if (video.current) video.current.srcObject = null;
        setLive(false);
        setError(tr(CAMERA_MESSAGES[classifyCameraError(e)].title));
      }
    } finally {
      if (ticket === epoch.current) setStarting(false);
    }
  };
  const record = async () => {
    if (!client.current || !model) return;
    const ticket = ++epoch.current;
    cameraOperation.current = true;
    setGuesses([]);
    setSampleLabel(null);
    setError('');
    setEmpty(false);
    setPhase('countdown');
    for (let n = prefs.countdown; n > 0; n--) {
      setCount(n);
      await sleep(1000);
      if (ticket !== epoch.current) return;
    }
    setPhase('recording');
    try {
      let input: Float32Array | null;
      if (kind === 'krsl') {
        tokens.current = [];
        recording.current = true;
        await sleep(2300);
        recording.current = false;
        if (ticket !== epoch.current) return;
        input = krslFeatures(tokens.current);
        tokens.current = [];
      } else {
        const v = video.current;
        if (!v || !v.videoWidth || v.readyState < 2)
          throw Error(t('Камера ещё не готова.', 'Камера әлі дайын емес.'));
        const canvas = document.createElement('canvas');
        canvas.width = 224;
        canvas.height = 224;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw Error('Canvas unavailable');
        input = new Float32Array(3 * 32 * 224 * 224);
        const begun = performance.now();
        for (let f = 0; f < 32; f++) {
          if (ticket !== epoch.current) return;
          ctx.drawImage(v, 0, 0, 224, 224);
          putRgbFrame(input, ctx.getImageData(0, 0, 224, 224).data, f);
          await sleep(Math.max(0, begun + ((f + 1) * 1000) / 30 - performance.now()));
        }
      }
      if (!input) {
        setEmpty(true);
        return;
      }
      setPhase('running');
      const started = performance.now();
      const result = await client.current.infer(input);
      if (ticket !== epoch.current) return;
      setLastMs(Math.round(performance.now() - started));
      setGuesses(result);
    } catch (e) {
      if (ticket === epoch.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === epoch.current) {
        cameraOperation.current = false;
        setPhase('idle');
      }
    }
  };
  const cameraOn = kind === 'krsl' ? snap.source === 'camera' : live;
  const accepted =
    guesses[0] &&
    model &&
    guesses[0].probability >= model.meta.threshold &&
    model.labels[guesses[0].index]?.ru !== 'no';
  const word = (label: LocalLabel) => (output === 'kk' ? (label.kk ?? label.ru) : label.ru);
  const topLabel = model?.labels[guesses[0]?.index ?? -1];
  const runSample = async () => {
    cameraOperation.current = false;
    if (!client.current || !model) return;
    const ticket = ++epoch.current;
    setPhase('running');
    setError('');
    setEmpty(false);
    setGuesses([]);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}models/krsl/examples.json`);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const examples = (await response.json()) as { ru: string; kk: string; features: number[] }[];
      const example = examples[sampleIndex];
      if (!example || example.features.length !== 168) throw Error('Invalid sample');
      const started = performance.now();
      const result = await client.current.infer(new Float32Array(example.features));
      if (ticket !== epoch.current) return;
      setSampleLabel(example);
      setGuesses(result);
      setLastMs(Math.round(performance.now() - started));
    } catch (e) {
      if (ticket === epoch.current) setError(String(e));
    } finally {
      if (ticket === epoch.current) setPhase('idle');
    }
  };
  return (
    <div className="native-grid">
      {!samplesOnly ? (
        <div className="capture-panel local-capture">
          {kind === 'krsl' ? (
            <Stage session={session} snap={snap} allowReplay={false} />
          ) : (
            <section aria-label={t('Камера РЖЯ', 'РЖЯ камерасы')}>
              <div className="native-camera">
                <video
                  ref={video}
                  muted
                  playsInline
                  aria-label={t('Видео с камеры', 'Камера видеосы')}
                  className={live ? (prefs.mirror ? 'mirrored' : '') : 'invisible'}
                />
                {!live ? (
                  <div className="camera-empty">
                    <Camera size={42} aria-hidden />
                    <h2>{t('Один жест. Один короткий ролик.', 'Бір ым. Бір қысқа жазба.')}</h2>
                    <p>
                      {t(
                        'В кадре должны быть видны лицо, плечи и обе руки.',
                        'Кадрда бет, иық және екі қол көрінуі керек.',
                      )}
                    </p>
                    <Button
                      variant="primary"
                      disabled={starting}
                      onClick={() => {
                        void start();
                      }}
                    >
                      {starting
                        ? t('Подключение…', 'Қосылуда…')
                        : t('Включить камеру', 'Камераны қосу')}
                    </Button>
                  </div>
                ) : (
                  <span className="camera-tag">
                    {t('РЖЯ · обработка на устройстве', 'РЖЯ · құрылғыда өңдеу')}
                  </span>
                )}
              </div>
              {live || starting ? (
                <Button className="mt-3" onClick={stop}>
                  <Square size={15} aria-hidden />
                  {t('Выключить камеру', 'Камераны өшіру')}
                </Button>
              ) : null}
            </section>
          )}
          <div className="capture-bar">
            <Button
              variant="primary"
              size="lg"
              disabled={!cameraOn || !model || phase !== 'idle'}
              onClick={() => {
                void record();
              }}
            >
              <CircleDot size={18} aria-hidden />
              {t('Записать жест', 'Ымды жазу')}
            </Button>
            {phase !== 'idle' ? <Button onClick={stop}>{t('Отменить', 'Бас тарту')}</Button> : null}
            <p role="status">
              {phase === 'countdown'
                ? t(`Приготовьтесь: ${count}`, `Дайындалыңыз: ${count}`)
                : phase === 'recording'
                  ? t('Сейчас покажите один жест…', 'Қазір бір ымды көрсетіңіз…')
                  : phase === 'running'
                    ? t('Вычисление на устройстве…', 'Құрылғыда есептелуде…')
                    : t(
                        `После нажатия будет ${prefs.countdown} сек. на подготовку.`,
                        `Батырмадан кейін дайындалуға ${prefs.countdown} сек. беріледі.`,
                      )}
            </p>
          </div>
        </div>
      ) : null}
      <div className="message-column">
        <Card className="p-5 result-card">
          <span className="eyebrow">{t('Результат распознавания', 'Тану нәтижесі')}</span>
          <h2>{kind === 'krsl' ? 'KRSL · 10' : t('Русский жестовый язык', 'Орыс ым тілі')}</h2>
          {samplesOnly ? (
            <p className="model-note">
              {kind === 'krsl'
                ? t(
                    'Пилот на данных из Казахстана. 10 отдельных слов; без вопросительной мимики и предложений.',
                    'Қазақстан деректеріндегі пилот. 10 жеке сөз; сұраулы мимика мен сөйлемдер танылмайды.',
                  )
                : t(
                    'Easy Sign S3D: отдельные жесты РЖЯ. Казахский перевод есть только для части словаря.',
                    'Easy Sign S3D: РЖЯ жеке ымдары. Сөздіктің бір бөлігіне ғана қазақша аударма бар.',
                  )}
            </p>
          ) : null}
          {!model && !error ? (
            <p role="status">{t('Загрузка модели…', 'Модель жүктелуде…')}</p>
          ) : null}
          {error ? (
            <div role="alert" className="error-box">
              <p>{t('Не удалось выполнить операцию.', 'Әрекетті орындау мүмкін болмады.')}</p>
              <p>{error}</p>
              <Button
                onClick={() => {
                  setModel(null);
                  setError('');
                  setGuesses([]);
                  stop();
                  setAttempt((n) => n + 1);
                }}
              >
                {t('Перезагрузить модель', 'Модельді қайта жүктеу')}
              </Button>
            </div>
          ) : null}
          <div className="main-result" aria-live="polite">
            {empty
              ? t(
                  'Руки не распознаны. Повторите при хорошем освещении.',
                  'Қол танылмады. Жақсы жарықта қайталаңыз.',
                )
              : guesses.length
                ? accepted
                  ? topLabel
                    ? word(topLabel)
                    : ''
                  : t('Не распознано уверенно', 'Сенімді танылмады')
                : t('Покажите жест', 'Ымды көрсетіңіз')}
          </div>
          {sampleLabel ? (
            <p className="sample-source" role="status">
              {t(
                'Записанный тестовый пример, не камера. Ожидаемое слово: ',
                'Жазылған тест мысалы, камера емес. Күтілетін сөз: ',
              )}
              <b>{sampleLabel[output]}</b>
            </p>
          ) : null}
          {guesses.length ? (
            <p className="model-note">
              {t(
                'Ниже — гипотезы модели. Выберите верную перед озвучиванием. Процент — оценка модели, не гарантия.',
                'Төменде модель болжамдары берілген. Дыбыстаудан бұрын дұрысын таңдаңыз. Пайыз кепілдік бермейді.',
              )}
            </p>
          ) : null}
          <ol className="candidate-list">
            {guesses.map((g) => {
              const label = model?.labels[g.index];
              if (!label || label.ru === 'no') return null;
              return (
                <li key={g.index}>
                  <button
                    onClick={() => {
                      onPick(word(label));
                    }}
                  >
                    <span>
                      {word(label)}
                      {output === 'kk' && !label.kk ? (
                        <small>{t('RU · перевод не добавлен', 'RU · аударма қосылмаған')}</small>
                      ) : null}
                    </span>
                    <b>{Math.round(g.probability * 100)}%</b>
                  </button>
                </li>
              );
            })}
          </ol>
          {lastMs !== null ? (
            <p className="model-note">
              {t(`Последнее вычисление: ${lastMs} мс`, `Соңғы есептеу: ${lastMs} мс`)}
            </p>
          ) : null}
          {kind === 'krsl' && samplesOnly ? (
            <details>
              <summary>{t('Словарь и проверка', 'Сөздік және тексеру')}</summary>
              <ul className="word-list">
                {model?.labels.map((l) => (
                  <li key={l.id}>{word(l)}</li>
                ))}
              </ul>
              <p>
                {t(
                  'Тест на 799 записях одного отдельного участника: 70,1%. Это не точность веб-камеры. Другой трекер и условия камеры требуют отдельного теста.',
                  'Бөлек қатысушының 799 жазбасындағы тест: 70,1%. Бұл веб-камера дәлдігі емес. Басқа трекер мен камера жағдайын бөлек тексеру қажет.',
                )}
              </p>
              <label className="field-label">
                {t('Контрольная запись без камеры', 'Камерасыз бақылау жазбасы')}
                <select
                  value={sampleIndex}
                  onChange={(e) => {
                    setSampleIndex(Number(e.target.value));
                  }}
                >
                  {model?.labels.map((l, i) => (
                    <option key={l.id} value={i}>
                      {word(l)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!model || phase !== 'idle'}
                onClick={() => {
                  void runSample();
                }}
              >
                {t('Распознать записанный пример', 'Жазылған мысалды тану')}
              </Button>
              <p className="model-note">
                {t(
                  'Используются сохранённые признаки отдельного тестового участника. Вычисление выполняется сейчас в браузере.',
                  'Бөлек тест қатысушысының сақталған белгілері қолданылады. Есептеу қазір браузерде орындалады.',
                )}
              </p>
              <a
                href={`${import.meta.env.BASE_URL}models/krsl/report.json`}
                target="_blank"
                rel="noreferrer"
              >
                {t('Отчёт модели', 'Модель есебі')}
              </a>
            </details>
          ) : null}
        </Card>
        {composer}
      </div>
    </div>
  );
}
