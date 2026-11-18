import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Delete, Pause, Play, Space, Square, Trash2, Check } from 'lucide-react';
import type { Session } from '../app/session';
import { openCamera, stopStream, CAMERA_MESSAGES, classifyCameraError } from '../lib/camera';
import { useLocale, tr } from '../locale';
import { LocalModel, type LocalGuess, type LocalLabel, type LocalMeta } from '../ml/local-model';
import { BukvaSampler } from '../ml/bukva-sampler';
import { EMPTY_SPELL, editSpell, spellStep, type SpellState } from '../ml/fingerspell';
import { Button, Card } from './ui';
import { useRecognitionPreferences } from '../recognition/preferences';

/**
 * Russian Sign Language fingerspelling (dactyl alphabet) with the Bukva model:
 * a continuous camera loop that writes one letter at a time.
 */
export function FingerspellPanel({
  session,
  onPick,
  composer,
}: {
  session: Session;
  onPick: (text: string) => void;
  composer?: ReactNode;
}) {
  const { t } = useLocale();
  const prefs = useRecognitionPreferences();
  const [model, setModel] = useState<{ labels: LocalLabel[]; meta: LocalMeta } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [guesses, setGuesses] = useState<LocalGuess[]>([]);
  const [spell, setSpell] = useState<SpellState>(EMPTY_SPELL);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const client = useRef<LocalModel | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const epoch = useRef(0);
  const sampler = useRef<BukvaSampler | null>(null);

  const halt = () => {
    epoch.current++;
    sampler.current?.stop();
    sampler.current = null;
    setRunning(false);
  };
  const stop = () => {
    halt();
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    session.stopCamera();
    setLive(false);
    setStarting(false);
    setGuesses([]);
  };

  useEffect(() => {
    let gone = false;
    const m = new LocalModel();
    client.current = m;
    m.load('bukva')
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
  }, [attempt]);

  useEffect(() => {
    const ticket = epoch;
    const loop = sampler;
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        epoch.current++;
        sampler.current?.stop();
        sampler.current = null;
        stopStream(stream.current);
        stream.current = null;
        if (video.current) video.current.srcObject = null;
        setRunning(false);
        setLive(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      ticket.current++;
      loop.current?.stop();
      stopStream(stream.current);
      stream.current = null;
    };
  }, []);

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

  const spellLoop = () => {
    const m = client.current;
    const v = video.current;
    if (!m || !model || !v) return;
    halt();
    const ticket = epoch.current;
    setError('');
    const threshold = model.meta.threshold;
    const labelOf = (g: LocalGuess | undefined) => {
      const label = g && g.probability >= threshold ? model.labels[g.index]?.ru : undefined;
      return label && label !== 'no' ? label : null;
    };
    const s = new BukvaSampler(
      v,
      (input) => m.infer(input),
      (result, ms) => {
        if (ticket !== epoch.current) return;
        setLastMs(ms);
        setGuesses(result);
        setSpell((state) => spellStep(state, labelOf(result[0])));
      },
      (e) => {
        if (ticket !== epoch.current) return;
        halt();
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    try {
      s.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    sampler.current = s;
    setRunning(true);
  };

  const letter = (g: LocalGuess) => model?.labels[g.index]?.ru;
  const top = guesses[0];
  const topLetter = top && top.probability >= (model?.meta.threshold ?? 1) ? letter(top) : null;
  const shownLetter = topLetter && topLetter !== 'no' ? topLetter : null;

  return (
    <div className="native-grid">
      <div className="capture-panel local-capture">
        <section aria-label={t('Камера дактиля', 'Дактиль камерасы')}>
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
                <h2>{t('Покажите слово по буквам', 'Сөзді әріппен көрсетіңіз')}</h2>
                <p>
                  {t(
                    'Рука с буквой должна быть хорошо видна. Держите каждую букву около секунды.',
                    'Әріп көрсетілген қол анық көрінуі керек. Әр әріпті шамамен бір секунд ұстаңыз.',
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
              <>
                <span className="camera-tag">
                  {t('Дактиль РЖЯ · на устройстве', 'РЖЯ дактилі · құрылғыда')}
                </span>
                {running ? (
                  <span className="fingerspell-live" aria-hidden>
                    {shownLetter ?? '·'}
                  </span>
                ) : null}
              </>
            )}
          </div>
          {live || starting ? (
            <Button className="mt-3" onClick={stop}>
              <Square size={15} aria-hidden />
              {t('Выключить камеру', 'Камераны өшіру')}
            </Button>
          ) : null}
        </section>
        <div className="capture-bar">
          {running ? (
            <Button variant="primary" size="lg" onClick={halt}>
              <Pause size={18} aria-hidden />
              {t('Пауза', 'Кідірту')}
            </Button>
          ) : (
            <Button variant="primary" size="lg" disabled={!live || !model} onClick={spellLoop}>
              <Play size={18} aria-hidden />
              {t('Начать распознавание букв', 'Әріптерді тануды бастау')}
            </Button>
          )}
          <p role="status">
            {!model && !error
              ? t('Загрузка модели…', 'Модель жүктелуде…')
              : running
                ? t(
                    'Показывайте буквы по одной. Чтобы повторить букву, опустите руку на мгновение.',
                    'Әріптерді бір-бірден көрсетіңіз. Әріпті қайталау үшін қолды сәл түсіріңіз.',
                  )
                : t(
                    'Камера анализируется прямо в браузере, видео никуда не отправляется.',
                    'Бейне браузерде талданады, ешқайда жіберілмейді.',
                  )}
          </p>
        </div>
      </div>
      <div className="message-column">
        <Card className="p-5 result-card">
          <span className="eyebrow">{t('Дактиль · алфавит', 'Дактиль · әліпби')}</span>
          <h2>{t('Русский дактиль (Bukva)', 'Орыс дактилі (Bukva)')}</h2>
          {error ? (
            <div role="alert" className="error-box">
              <p>{t('Не удалось выполнить операцию.', 'Әрекетті орындау мүмкін болмады.')}</p>
              <p>{error}</p>
              <Button
                onClick={() => {
                  setModel(null);
                  setError('');
                  stop();
                  setAttempt((n) => n + 1);
                }}
              >
                {t('Перезагрузить модель', 'Модельді қайта жүктеу')}
              </Button>
            </div>
          ) : null}
          <div className="main-result fingerspell-text" aria-live="polite">
            {spell.text ? (
              <span>
                {spell.text}
                <span className="fingerspell-caret" aria-hidden />
              </span>
            ) : (
              <span className="fingerspell-placeholder">
                {t('Здесь появятся буквы', 'Әріптер осында шығады')}
              </span>
            )}
          </div>
          <div className="fingerspell-tools">
            <Button
              size="sm"
              onClick={() => {
                setSpell((s) => editSpell(s, 'space'));
              }}
            >
              <Space size={15} aria-hidden />
              {t('Пробел', 'Бос орын')}
            </Button>
            <Button
              size="sm"
              disabled={!spell.text}
              onClick={() => {
                setSpell((s) => editSpell(s, 'backspace'));
              }}
            >
              <Delete size={15} aria-hidden />
              {t('Стереть', 'Өшіру')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!spell.text}
              onClick={() => {
                setSpell(EMPTY_SPELL);
              }}
            >
              <Trash2 size={15} aria-hidden />
              {t('Очистить', 'Тазалау')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!spell.text.trim()}
              onClick={() => {
                onPick(spell.text.trim());
              }}
            >
              <Check size={15} aria-hidden />
              {t('В текст', 'Мәтінге')}
            </Button>
          </div>
          {guesses.length ? (
            <>
              <p className="model-note">
                {t(
                  'Сейчас модель видит (нажмите, чтобы добавить букву вручную):',
                  'Қазір модель көреді (әріпті қолмен қосу үшін басыңыз):',
                )}
              </p>
              <ol className="candidate-list">
                {guesses.map((g) => {
                  const l = letter(g);
                  if (!l) return null;
                  return (
                    <li key={g.index}>
                      <button
                        disabled={l === 'no'}
                        onClick={() => {
                          setSpell((s) => editSpell(s, { add: l }));
                        }}
                      >
                        <span>{l === 'no' ? t('нет буквы', 'әріп жоқ') : l}</span>
                        <b>{Math.round(g.probability * 100)}%</b>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
          {lastMs !== null ? (
            <p className="model-note">
              {t(`Последнее вычисление: ${lastMs} мс`, `Соңғы есептеу: ${lastMs} мс`)}
            </p>
          ) : null}
          <details>
            <summary>{t('Алфавит и ограничения', 'Әліпби және шектеулер')}</summary>
            <ul className="word-list fingerspell-alphabet">
              {model?.labels
                .filter((l) => l.ru !== 'no')
                .sort((a, b) => a.ru.localeCompare(b.ru, 'ru'))
                .map((l) => (
                  <li key={l.id}>{l.ru}</li>
                ))}
            </ul>
            <p className="model-note">
              {t(
                'Модель Bukva (ai-forever, MobileNetV2-TSM) знает 33 буквы русского дактиля. Точность авторов на тестовых участниках — 83,6%, это не точность вашей веб-камеры. Казахские буквы Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І не распознаются.',
                'Bukva моделі (ai-forever, MobileNetV2-TSM) орыс дактилінің 33 әрпін біледі. Авторлардың тест қатысушыларындағы дәлдігі — 83,6%, бұл сіздің веб-камераңыздың дәлдігі емес. Қазақтың Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І әріптері танылмайды.',
              )}
            </p>
            <a href="https://github.com/ai-forever/bukva" target="_blank" rel="noreferrer">
              {t('Источник: ai-forever/bukva ↗', 'Дереккөз: ai-forever/bukva ↗')}
            </a>
          </details>
        </Card>
        {composer}
      </div>
    </div>
  );
}
