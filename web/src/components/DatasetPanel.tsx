import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleDot, Download, FolderPlus, Square, Trash2 } from 'lucide-react';
import type { Session } from '../app/session';
import { useLocale } from '../locale';
import {
  CAPTURE_MS,
  CONSENT_VERSION,
  HandCapture,
  MAX_SAMPLES,
  SCHEMA_VERSION,
  assessQuality,
  exportDataset,
  validLabel,
  type DatasetSample,
  type SampleLabel,
} from '../dataset/schema';
import { DatasetStore } from '../dataset/store';
import { Stage } from './Stage';
import { Button, Card } from './ui';
import { DatasetReplay } from './DatasetReplay';
import { dependencies } from '../../package.json';

const store = new DatasetStore();
const initialLabel: SampleLabel = { language: 'krsl', classId: '', ru: '', kk: '' };
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function DatasetPanel({ session }: { session: Session }) {
  const { lang, t } = useLocale();
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [label, setLabel] = useState<SampleLabel>(initialLabel);
  const [participantId, setParticipantId] = useState('');
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID() as string);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [samples, setSamples] = useState<DatasetSample[]>([]);
  const [draft, setDraft] = useState<DatasetSample | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'recording'>('idle');
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const capture = useRef<HandCapture | null>(null);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const frozen = phase !== 'idle' || busy;
  const metadataValid =
    validLabel(label) && participantId.trim().length > 0 && sessionId.trim().length > 0;

  const cancel = () => {
    operation.current?.abort();
    operation.current = null;
    capture.current = null;
    setPhase('idle');
  };
  useEffect(() => {
    alive.current = true;
    store
      .load()
      .then((saved) => {
        if (alive.current) {
          setSamples(saved);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive.current) setError(true);
      });
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        operation.current?.abort();
        capture.current = null;
        setPhase('idle');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false;
      operation.current?.abort();
      capture.current = null;
      session.stopCamera();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [session]);
  useEffect(
    () =>
      session.onFrame((frame, source, info) => {
        if (source === 'camera') capture.current?.add(frame, info.t, info.poses);
      }),
    [session],
  );
  useEffect(
    () =>
      session.subscribe(() => {
        if (session.getSnapshot().source !== 'camera') {
          operation.current?.abort();
          capture.current = null;
          setPhase('idle');
        }
      }),
    [session],
  );

  const record = async () => {
    const camera = session.getCameraInfo();
    if (!camera) return;
    if (!consentAt || !metadataValid || !snap.trackerInfo || frozen || snap.source !== 'camera')
      return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setDraft(null);
    setNotice('');
    setPhase('countdown');
    for (let n = 3; n > 0; n--) {
      setCount(n);
      if (!(await wait(1000, controller.signal))) return;
    }
    const recording = new HandCapture(performance.now());
    capture.current = recording;
    const recordedAt = new Date().toISOString();
    setPhase('recording');
    if (!(await wait(CAPTURE_MS, controller.signal))) return;
    capture.current = null;
    operation.current = null;
    const frames = recording.frames;
    setDraft({
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      recordedAt,
      label: { ...label },
      participantId: participantId.trim(),
      sessionId: sessionId.trim(),
      consent: {
        version: CONSENT_VERSION,
        acceptedAt: consentAt,
        scope: 'local-landmarks-and-export',
      },
      source: 'camera',
      camera,
      tracker: {
        library: '@mediapipe/tasks-vision',
        version: dependencies['@mediapipe/tasks-vision'],
        ...snap.trackerInfo,
        landmarkModel:
          snap.trackerInfo.featureSet === 'hands_pose_lips'
            ? 'holistic_landmarker.task'
            : 'hand_landmarker.task + pose_landmarker_lite.task',
      },
      coordinates: 'mediapipe-normalized-xyz-unmirrored',
      featureVersion: 'raw-hands-xyz-v1',
      durationMs: CAPTURE_MS,
      frames,
      quality: assessQuality(frames, CAPTURE_MS),
    });
    setPhase('idle');
  };

  const mutate = async (run: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    setNotice('');
    try {
      await run();
      const saved = await store.load();
      if (alive.current) {
        setSamples(saved);
        setLoaded(true);
        setNotice(message);
      }
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const saveDraft = () => {
    if (!draft || !consentAt || draft.quality.issues.length) return;
    void mutate(
      async () => {
        await store.save(replaceId ? { ...draft, id: replaceId } : draft);
        if (alive.current) {
          setDraft(null);
          setReplaceId(null);
        }
      },
      t('Пример сохранён на устройстве.', 'Мысал құрылғыда сақталды.'),
    );
  };
  const exportAll = async () => {
    setBusy(true);
    setError(false);
    try {
      const saved = await store.load();
      const blob = new Blob([exportDataset(saved)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `signtalk-dataset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      if (alive.current) {
        setSamples(saved);
        setNotice(
          t(
            'JSON-экспорт подготовлен. Храните файл ответственно.',
            'JSON экспорты дайын. Файлды жауапкершілікпен сақтаңыз.',
          ),
        );
      }
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const qualityText = (sample: DatasetSample) =>
    `${sample.quality.handFrames}/${sample.quality.frames} ${t('кадров с рукой', 'қолы көрінген кадр')} · ${sample.quality.observedFps.toFixed(1)} FPS`;

  return (
    <section className="dataset-panel" aria-labelledby="dataset-title">
      <div className="workspace-heading">
        <h2 id="dataset-title">
          {t('Сбор примеров местных жестов', 'Жергілікті ым мысалдарын жинау')}
        </h2>
        <FolderPlus size={22} aria-hidden />
      </div>
      <p className="model-note mb-5">
        {t(
          'Эти записи — данные для будущего обучения. Они не добавляют новые слова в модель и не связаны с персональными ASL-прототипами.',
          'Бұл жазбалар болашақ оқытуға арналған деректер. Олар модельге жаңа сөз қоспайды және жеке ASL прототиптерінен бөлек сақталады.',
        )}
      </p>
      <div className="native-grid">
        <div>
          <Card className="p-5 mb-4">
            <h3>{t('1. Согласие участника', '1. Қатысушының келісімі')}</h3>
            <p id="dataset-privacy" className="model-note mt-2">
              {t(
                'Сохраняются координаты 21 точки каждой руки, время кадров, метки, псевдоним и версия трекера. Видео, лицо и аудио не сохраняются. Записи хранятся в этом браузере; JSON-файл выгружается только по кнопке. Псевдоним не гарантирует анонимность. Не указывайте ФИО. Перед передачей файла другим людям получите отдельное разрешение участника.',
                'Әр қолдың 21 нүктесінің координаттары, кадр уақыты, белгілер, бүркеншік ат және трекер нұсқасы сақталады. Бейне, бет және аудио сақталмайды. Жазбалар осы браузерде қалады; JSON файл батырмамен ғана жүктеледі. Бүркеншік ат анонимдікке кепіл емес. Толық аты-жөнді жазбаңыз. Файлды басқаларға бермес бұрын қатысушыдан бөлек рұқсат алыңыз.',
              )}
            </p>
            <label className="consent">
              <input
                type="checkbox"
                aria-describedby="dataset-privacy"
                checked={consentAt !== null}
                onChange={(e) => {
                  setConsentAt(e.target.checked ? new Date().toISOString() : null);
                  if (!e.target.checked) {
                    cancel();
                    session.stopCamera();
                    setDraft(null);
                    setReplaceId(null);
                  }
                }}
              />
              {t(
                'Участник согласен на локальную запись координат и экспорт',
                'Қатысушы координаттарды жергілікті жазуға және экспорттауға келіседі',
              )}
            </label>
          </Card>
          {consentAt ? (
            <Stage session={session} snap={snap} allowReplay={false} />
          ) : (
            <div className="dataset-placeholder">
              {t(
                'Камера доступна после согласия участника.',
                'Камера қатысушы келіскеннен кейін қолжетімді.',
              )}
            </div>
          )}
          <div className="capture-bar">
            <Button
              size="lg"
              variant="primary"
              disabled={
                !loaded ||
                !consentAt ||
                !metadataValid ||
                snap.source !== 'camera' ||
                !snap.trackerInfo ||
                !!snap.trackerError ||
                frozen ||
                !!editId ||
                !!draft ||
                (samples.length >= MAX_SAMPLES && !replaceId)
              }
              onClick={() => {
                void record();
              }}
            >
              <CircleDot size={18} aria-hidden />
              {t('Записать пример', 'Мысалды жазу')}
            </Button>
            {phase !== 'idle' ? (
              <Button onClick={cancel}>
                <Square size={16} aria-hidden />
                {t('Отменить запись', 'Жазудан бас тарту')}
              </Button>
            ) : null}
          </div>
          <p role="status" className="model-note">
            {phase === 'countdown'
              ? t(`Приготовьтесь: ${count}`, `Дайындалыңыз: ${count}`)
              : phase === 'recording'
                ? t('Показывайте один жест — 2,5 секунды…', 'Бір ымды көрсетіңіз — 2,5 секунд…')
                : t(
                    'Отсчёт 3 секунды → запись 2,5 секунды → проверка → сохранение.',
                    '3 секунд кері санау → 2,5 секунд жазу → тексеру → сақтау.',
                  )}
          </p>
          {draft ? (
            <Card className="p-5 mt-4">
              <h3>
                {t('Проверьте пример', 'Мысалды тексеріңіз')} · {draft.label[lang]}
              </h3>
              <p className="model-note mt-2">{qualityText(draft)}</p>
              <DatasetReplay sample={draft} />
              {draft.quality.issues.length ? (
                <p role="alert" className="error-box mt-3">
                  {t(
                    'Пример не прошёл проверку: мало кадров, руки пропадают, трекер работает медленно или в кадре несколько людей. Улучшите освещение, держите руки в кадре и повторите запись.',
                    'Мысал тексеруден өтпеді: кадр аз, қол көрінбейді, трекер баяу немесе кадрда бірнеше адам бар. Жарықты жақсартып, қолды кадрда ұстап, қайта жазыңыз.',
                  )}
                </p>
              ) : (
                <p className="model-note mt-2">
                  {t(
                    'Техническое качество достаточно. Проверьте правильность самого жеста и метки.',
                    'Техникалық сапа жеткілікті. Ым мен белгінің дұрыстығын тексеріңіз.',
                  )}
                </p>
              )}
              <div className="dataset-actions mt-3">
                <Button
                  variant="primary"
                  disabled={busy || !consentAt || draft.quality.issues.length > 0}
                  onClick={saveDraft}
                >
                  {replaceId
                    ? t('Сохранить вместо прежнего', 'Алдыңғының орнына сақтау')
                    : t('Сохранить пример', 'Мысалды сақтау')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                  }}
                >
                  {t('Перезаписать', 'Қайта жазу')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setReplaceId(null);
                  }}
                >
                  {t('Отбросить', 'Алып тастау')}
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
        <Card className="p-5">
          <h3>{t('2. Метка и участник', '2. Белгі және қатысушы')}</h3>
          <fieldset disabled={frozen || !!draft} className="dataset-fields">
            <label>
              {t('Жестовый язык набора', 'Жинақтың ым тілі')}
              <select
                value={label.language}
                onChange={(e) => {
                  setLabel({ ...label, language: e.target.value as SampleLabel['language'] });
                }}
              >
                <option value="krsl">Қазақстан · KRSL</option>
                <option value="rsl">РЖЯ / RSL</option>
                <option value="asl">ASL</option>
              </select>
            </label>
            <label>
              {t('Идентификатор класса', 'Класс идентификаторы')}
              <input
                value={label.classId}
                maxLength={64}
                placeholder="salem"
                onChange={(e) => {
                  setLabel({ ...label, classId: e.target.value });
                }}
                aria-describedby="class-id-hint"
              />
            </label>
            <p id="class-id-hint" className="model-note">
              {t(
                'Латинские a–z, цифры, точка, дефис, _. Например: salem.',
                'Латын a–z әріптері, сандар, нүкте, дефис, _. Мысалы: salem.',
              )}
            </p>
            <label>
              {t('Название на русском', 'Орысша атауы')}
              <input
                lang="ru"
                value={label.ru}
                maxLength={100}
                onChange={(e) => {
                  setLabel({ ...label, ru: e.target.value });
                }}
              />
            </label>
            <label>
              {t('Название на казахском', 'Қазақша атауы')}
              <input
                lang="kk"
                value={label.kk}
                maxLength={100}
                onChange={(e) => {
                  setLabel({ ...label, kk: e.target.value });
                }}
              />
            </label>
            <label>
              {t('Псевдоним участника', 'Қатысушының бүркеншік аты')}
              <input
                value={participantId}
                maxLength={64}
                placeholder="P01"
                disabled={!!editId}
                onChange={(e) => {
                  setParticipantId(e.target.value);
                }}
              />
            </label>
            <label>
              {t('Сессия записи', 'Жазу сессиясы')}
              <input
                value={sessionId}
                maxLength={100}
                disabled={!!editId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                }}
              />
            </label>
            <p className="model-note">
              {t(
                'Один человек — один псевдоним во всех сессиях. Разделяйте обучение и тест по людям.',
                'Барлық сессияда бір адамға бір бүркеншік ат қолданыңыз. Оқыту мен тестті адамдар бойынша бөліңіз.',
              )}
            </p>
          </fieldset>
          {editId ? (
            <div className="dataset-actions mt-3">
              <Button
                disabled={busy || !validLabel(label)}
                variant="primary"
                onClick={() => {
                  const sample = samples.find((s) => s.id === editId);
                  if (sample)
                    void mutate(
                      async () => {
                        await store.save({ ...sample, label: { ...label } });
                        if (alive.current) setEditId(null);
                      },
                      t('Метка исправлена.', 'Белгі түзетілді.'),
                    );
                }}
              >
                {t('Сохранить метку', 'Белгіні сақтау')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setEditId(null);
                }}
              >
                {t('Отменить', 'Бас тарту')}
              </Button>
            </div>
          ) : null}
          {replaceId ? (
            <p className="sample-source">
              {t(
                'Повтор записи: прежний пример заменится только после успешного сохранения.',
                'Қайта жазу: алдыңғы мысал сәтті сақталғаннан кейін ғана ауыстырылады.',
              )}
              <Button
                disabled={frozen}
                onClick={() => {
                  setReplaceId(null);
                  setDraft(null);
                }}
              >
                {t('Отменить замену', 'Ауыстырудан бас тарту')}
              </Button>
            </p>
          ) : null}
          {!metadataValid ? (
            <p className="model-note mt-3">
              {t(
                'Заполните все поля, чтобы начать запись.',
                'Жазуды бастау үшін барлық өрісті толтырыңыз.',
              )}
            </p>
          ) : null}
        </Card>
      </div>
      {error ? (
        <div role="alert" className="error-box mt-4">
          <p>
            {t(
              'Не удалось прочитать или сохранить данные. Проверьте доступ к хранилищу и свободное место. Уже сохранённые записи не удалены; несохранённый пример остаётся на странице.',
              'Деректерді оқу немесе сақтау мүмкін болмады. Жадқа қолжетімділікті және бос орынды тексеріңіз. Сақталған жазбалар жойылған жоқ; сақталмаған мысал бетте қалады.',
            )}
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void mutate(async () => {}, t('Хранилище доступно.', 'Жад қолжетімді.'));
            }}
          >
            {t('Повторить загрузку', 'Қайта жүктеу')}
          </Button>
        </div>
      ) : null}
      <p role="status" className="model-note mt-3">
        {busy ? t('Сохранение…', 'Сақталуда…') : notice}
      </p>
      <section className="dataset-samples mt-6" aria-labelledby="saved-samples-title">
        <div className="workspace-heading">
          <h3 id="saved-samples-title">
            {t('3. Сохранённые примеры', '3. Сақталған мысалдар')} · {samples.length}/{MAX_SAMPLES}
          </h3>
          <Button
            disabled={!loaded || !samples.length || frozen}
            onClick={() => {
              void exportAll();
            }}
          >
            <Download size={16} aria-hidden />
            {t('Экспорт JSON', 'JSON экспорттау')}
          </Button>
        </div>
        <p className="model-note mb-3">
          {t(
            'Хранилище привязано к браузеру и адресу сайта, включая порт. Очистка данных браузера удалит записи. Регулярно экспортируйте JSON.',
            'Жад браузер мен сайт мекенжайына, соның ішінде портқа байланысты. Браузер деректерін тазарту жазбаларды жояды. JSON файлын жүйелі экспорттаңыз.',
          )}
        </p>
        {!samples.length ? (
          <p className="model-note">
            {loaded
              ? t('Сохранённых примеров пока нет.', 'Сақталған мысал әлі жоқ.')
              : t('Загрузка локальных записей…', 'Жергілікті жазбалар жүктелуде…')}
          </p>
        ) : null}
        <ul className="dataset-list">
          {samples.map((sample) => (
            <li key={sample.id}>
              <div>
                <b>{sample.label[lang]}</b>{' '}
                <span className="model-note">
                  {sample.label.language.toUpperCase()} · {sample.label.classId} ·{' '}
                  {sample.participantId}
                </span>
                <p className="model-note">
                  {qualityText(sample)} ·{' '}
                  {new Date(sample.recordedAt).toLocaleString(lang === 'kk' ? 'kk-KZ' : 'ru-RU')}
                </p>
              </div>
              <div className="dataset-actions">
                <Button
                  disabled={frozen || !!draft}
                  onClick={() => {
                    setPreviewId(previewId === sample.id ? null : sample.id);
                  }}
                >
                  {t('Просмотреть', 'Көру')}
                </Button>
                <Button
                  disabled={frozen || !!draft || !!replaceId}
                  onClick={() => {
                    setLabel({ ...sample.label });
                    setParticipantId(sample.participantId);
                    setSessionId(sample.sessionId);
                    setEditId(sample.id);
                    document.getElementById('dataset-title')?.scrollIntoView();
                  }}
                >
                  {t('Исправить метку', 'Белгіні түзету')}
                </Button>
                <Button
                  disabled={frozen || !!draft || !!editId}
                  onClick={() => {
                    setLabel({ ...sample.label });
                    setParticipantId(sample.participantId);
                    setSessionId(sample.sessionId);
                    setReplaceId(sample.id);
                    document.getElementById('dataset-title')?.scrollIntoView();
                  }}
                >
                  {t('Повторить запись', 'Қайта жазу')}
                </Button>
                <Button
                  variant="danger"
                  disabled={frozen || !!draft || !!editId || !!replaceId}
                  onClick={() => {
                    void mutate(
                      () => store.remove(sample.id),
                      t('Пример удалён.', 'Мысал жойылды.'),
                    );
                  }}
                  aria-label={t(
                    `Удалить пример ${sample.label.ru}`,
                    `${sample.label.kk} мысалын жою`,
                  )}
                >
                  <Trash2 size={16} aria-hidden />
                  {t('Удалить', 'Жою')}
                </Button>
              </div>
              {previewId === sample.id ? <DatasetReplay sample={sample} /> : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
