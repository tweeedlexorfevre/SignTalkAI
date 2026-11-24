import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleDot,
  FolderPlus,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import type { Session } from '../app/session';
import { useLocale } from '../locale';
import { Stage } from '../components/Stage';
import { ModelGate } from '../components/ModelGate';
import { Button, Card } from '../components/ui';
import { errorText } from '../messenger/api';
import {
  MAX_GESTURES,
  MAX_NAME_LENGTH,
  MAX_TAKES,
  MIN_TAKES,
  isReady,
  type GestureMatch,
} from '../ml/prototypes';
import {
  library,
  useGestureLibrary,
  type LibraryGesture,
  type LibrarySnapshot,
  type TakeQuality,
} from '../gestures/library';
import { LibraryGate } from '../gestures/LibraryGate';
import { MatchResult } from '../gestures/PersonalWorkspace';
import { TakePreviewCanvas } from '../gestures/TakePreview';
import { makePreview } from '../gestures/preview';
import { setRecognitionPreferences } from '../recognition/preferences';
import bukvaLabels from '../../public/models/bukva/labels.json';

type T = (ru: string, kk: string) => string;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const lower = (s: string) => s.toLocaleLowerCase('ru');

function TakeDots({ count }: { count: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: MAX_TAKES }, (_, i) => (
        <span
          key={i}
          className={`size-2 rounded-full ${
            i < count ? 'bg-accent' : i < MIN_TAKES ? 'bg-ink-muted/35' : 'bg-ink-muted/15'
          }`}
        />
      ))}
    </span>
  );
}

/** Inline "name" editor used for sets and gestures. */
function NameForm({
  initial,
  label,
  submit,
  onDone,
}: {
  initial: string;
  label: string;
  submit: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = clean(value);
        if (!name) {
          setError(t('Напишите название.', 'Атауын жазыңыз.'));
          return;
        }
        submit(name)
          .then(onDone)
          .catch((err: unknown) => {
            setError(errorText(err, t));
          });
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={MAX_NAME_LENGTH}
        aria-label={label}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 text-sm"
      />
      <Button size="sm" type="submit">
        {t('Сохранить', 'Сақтау')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t('Отмена', 'Болдырмау')}
      </Button>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </form>
  );
}

function SetBar({ lib, t }: { lib: LibrarySnapshot; t: T }) {
  const [adding, setAdding] = useState(false);
  const [addingGlobal, setAddingGlobal] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const active = lib.sets.find((s) => s.id === lib.activeSetId);
  const canEditActive = active?.scope !== 'global' || lib.isAdmin;
  return (
    <section className="content-card space-y-3" aria-label={t('Наборы жестов', 'Ым жинақтары')}>
      <div className="flex flex-wrap items-center gap-2" role="group">
        {lib.sets.map((s) => {
          const count = lib.gestures.filter((g) => g.setId === s.id).length;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === lib.activeSetId}
              onClick={() => {
                library.setActiveSet(s.id);
                setRenaming(false);
                setConfirmDelete(false);
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                s.id === lib.activeSetId
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
                  : 'border-line hover:bg-surface-muted'
              }`}
            >
              {s.name} <span className="opacity-70">· {count}</span>
            </button>
          );
        })}
        {adding || addingGlobal || !canEditActive ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(true);
            }}
          >
            <FolderPlus aria-hidden className="size-4" />
            {t('Новый набор', 'Жаңа жинақ')}
          </Button>
        )}
        {lib.isAdmin && !adding && !addingGlobal ? (
          <Button size="sm" variant="ghost" onClick={() => setAddingGlobal(true)}>
            <FolderPlus aria-hidden className="size-4" />
            {t('Общий набор', 'Ортақ жинақ')}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <NameForm
          initial=""
          label={t('Название нового набора', 'Жаңа жинақ атауы')}
          submit={async (name) => {
            const set = await library.createSet(name);
            library.setActiveSet(set.id);
          }}
          onDone={() => {
            setAdding(false);
          }}
        />
      ) : null}
      {addingGlobal ? (
        <NameForm
          initial=""
          label={t('Название общего набора', 'Ортақ жинақ атауы')}
          submit={async (name) => { const set = await library.createGlobalSet(name); library.setActiveSet(set.id); }}
          onDone={() => setAddingGlobal(false)}
        />
      ) : null}
      {active && !adding && !addingGlobal && canEditActive ? (
        renaming ? (
          <NameForm
            initial={active.name}
            label={t('Название набора', 'Жинақ атауы')}
            submit={(name) => library.renameSet(active.id, name)}
            onDone={() => {
              setRenaming(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>
              {t(
                'Распознавание и звонки используют выбранный набор.',
                'Тану мен қоңырау таңдалған жинақты қолданады.',
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenaming(true);
              }}
            >
              <Pencil aria-hidden className="size-4" />
              {t('Переименовать', 'Атын өзгерту')}
            </Button>
            {lib.sets.length > 1 ? (
              confirmDelete ? (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-danger">
                    {t(
                      'Удалить набор и все его жесты?',
                      'Жинақ пен оның барлық ымын жою керек пе?',
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setConfirmDelete(false);
                      library.deleteSet(active.id).catch((e: unknown) => {
                        setNotice(errorText(e, t));
                      });
                    }}
                  >
                    {t('Удалить', 'Жою')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmDelete(false);
                    }}
                  >
                    {t('Отмена', 'Болдырмау')}
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t('Удалить набор', 'Жинақты жою')}
                </Button>
              )
            ) : null}
          </div>
        )
      ) : null}
      {notice ? <p className="text-sm text-warn">{notice}</p> : null}
    </section>
  );
}

function verdictText(q: TakeQuality, t: T): string {
  if (q.verdict === 'confused' && q.nearest)
    return t(`Похож на «${q.nearest.name}»`, `«${q.nearest.name}» ымына ұқсас`);
  if (q.verdict === 'weak') return t('Не похож на остальные', 'Басқаларына ұқсамайды');
  return t('Хороший', 'Жақсы');
}

function TakeCard({
  gesture,
  index,
  quality,
  t,
  onDelete,
}: {
  gesture: LibraryGesture;
  index: number;
  quality: TakeQuality | undefined;
  t: T;
  onDelete: () => void;
}) {
  const preview = gesture.previews[index];
  const bad = quality && quality.verdict !== 'good';
  return (
    <li className="space-y-2 rounded-xl border border-line p-2" data-testid="take-card">
      {preview ? (
        <TakePreviewCanvas
          preview={preview}
          label={t(
            `Повтор ${index + 1} жеста «${gesture.name}», анимация рук`,
            `«${gesture.name}» ымының ${index + 1}-қайталауы, қол анимациясы`,
          )}
        />
      ) : (
        <div className="grid aspect-[4/3] place-items-center rounded-lg bg-surface-muted px-2 text-center text-xs text-ink-muted">
          {gesture.previewsLoaded
            ? t('Записан без просмотра', 'Көріністі сақтамай жазылған')
            : t('Загрузка…', 'Жүктелуде…')}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs">
          <p className="font-semibold">
            {t('Повтор', 'Қайталау')} {index + 1}
          </p>
          {quality ? (
            <p
              className={`flex items-center gap-1 ${bad ? 'text-warn' : 'text-success'}`}
              data-verdict={quality.verdict}
            >
              {bad ? (
                <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <Check aria-hidden className="size-3.5 shrink-0" />
              )}
              {verdictText(quality, t)}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={t(`Удалить повтор ${index + 1}`, `${index + 1}-қайталауды жою`)}
        >
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
    </li>
  );
}

interface Armed {
  id: string;
  /** Keep recording until the gesture has MIN_TAKES takes; otherwise record one. */
  untilReady: boolean;
}

function GestureDetail({
  gesture,
  lib,
  armed,
  setArmed,
  match,
  onBack,
  onError,
  t,
}: {
  gesture: LibraryGesture;
  lib: LibrarySnapshot;
  armed: Armed | null;
  setArmed: (a: Armed | null) => void;
  match: GestureMatch | null;
  onBack: () => void;
  onError: (e: unknown) => void;
  t: T;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState<'retake' | 'delete' | null>(null);
  const quality = library.quality(gesture);
  // The list comes without the skeleton animations; fetch them for this card.
  const requested = useRef('');
  useEffect(() => {
    const key = `${gesture.id}:${String(gesture.updatedAt)}`;
    if (gesture.previewsLoaded || requested.current === key) return;
    requested.current = key;
    library.loadPreviews(gesture.id).catch(onError);
  }, [gesture.id, gesture.updatedAt, gesture.previewsLoaded, onError]);
  const problems = quality.filter((q) => q.verdict !== 'good').length;
  const canEdit = !gesture.readOnly;
  const recording = armed?.id === gesture.id;
  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {t('Все жесты набора', 'Жинақтың барлық ымы')}
      </Button>
      {renaming && canEdit ? (
        <NameForm
          initial={gesture.name}
          label={t('Значение жеста', 'Ым мағынасы')}
          submit={(name) => library.update(gesture.id, { name })}
          onDone={() => {
            setRenaming(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-2xl font-semibold tracking-tight">{gesture.name}</h3>
          {canEdit ? <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRenaming(true);
            }}
          >
            <Pencil aria-hidden className="size-4" />
            {t('Изменить значение', 'Мағынасын өзгерту')}
          </Button> : null}
        </div>
      )}
      {canEdit ? <label className="inline-setting">
        <span>{t('Набор', 'Жинақ')}</span>
        <select
          value={gesture.setId ?? ''}
          onChange={(e) => {
            library.update(gesture.id, { setId: e.target.value }).catch(onError);
          }}
        >
          {lib.sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label> : null}
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <TakeDots count={gesture.takes.length} />
        <span>
          {gesture.takes.length}/{MAX_TAKES} {t('повторов', 'қайталау')}
          {gesture.stale
            ? t(' · запишите заново (модель обновилась)', ' · қайта жазыңыз (модель жаңарды)')
            : isReady(gesture)
              ? problems
                ? t(` · проблемных: ${problems}`, ` · күмәнді: ${problems}`)
                : t(' · готов', ' · дайын')
              : t(` · нужно ${MIN_TAKES}`, ` · ${MIN_TAKES} қажет`)}
        </span>
      </div>

      {canEdit ? <div className="flex flex-wrap gap-2">
        {recording ? (
          <Button
            onClick={() => {
              setArmed(null);
            }}
          >
            <Square aria-hidden className="size-4" />
            {t('Остановить запись', 'Жазуды тоқтату')}
          </Button>
        ) : gesture.takes.length < MAX_TAKES ? (
          <Button
            variant="primary"
            onClick={() => {
              setArmed({ id: gesture.id, untilReady: !isReady(gesture) });
            }}
          >
            <CircleDot aria-hidden className="size-4" />
            {t('Записать повтор', 'Қайталау жазу')}
          </Button>
        ) : null}
        {confirm === null ? (
          <>
            {gesture.takes.length ? (
              <Button
                onClick={() => {
                  setConfirm('retake');
                }}
              >
                <RotateCcw aria-hidden className="size-4" />
                {t('Перезаписать всё', 'Бәрін қайта жазу')}
              </Button>
            ) : null}
            <Button
              variant="danger"
              onClick={() => {
                setConfirm('delete');
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('Удалить жест', 'Ымды жою')}
            </Button>
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-danger">
              {confirm === 'retake'
                ? t(
                    'Удалить все повторы и записать заново?',
                    'Барлық қайталауды жойып, қайта жазу керек пе?',
                  )
                : t('Удалить жест совсем?', 'Ымды толық жою керек пе?')}
            </span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'retake') {
                  library
                    .removeTake(gesture.id)
                    .then(() => {
                      setArmed({ id: gesture.id, untilReady: true });
                    })
                    .catch(onError);
                } else {
                  setArmed(null);
                  library.remove(gesture.id).then(onBack).catch(onError);
                }
              }}
            >
              {t('Да', 'Иә')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirm(null);
              }}
            >
              {t('Отмена', 'Болдырмау')}
            </Button>
          </span>
        )}
      </div> : null}

      <div aria-live="polite" data-testid="teach-status">
        {recording ? (
          <p className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm font-medium">
            <CircleDot aria-hidden className="pulse-dot size-4 text-accent" />
            {t(
              `Запись повтора ${gesture.takes.length + 1}. Включите камеру, покажите жест «${gesture.name}» и опустите руки.`,
              `${gesture.takes.length + 1}-қайталау жазылуда. Камераны қосып, «${gesture.name}» ымын көрсетіңіз де, қолды түсіріңіз.`,
            )}
          </p>
        ) : isReady(gesture) ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-muted">
              {t(
                `Проверка: покажите «${gesture.name}» — увидите, как он распознаётся среди жестов набора.`,
                `Тексеру: «${gesture.name}» ымын көрсетіңіз — ол жинақ ымдары арасында қалай танылатынын көресіз.`,
              )}
            </p>
            <MatchResult match={match} expected={gesture.id} compact />
          </div>
        ) : null}
      </div>

      {gesture.takes.length ? (
        <ul
          className="grid grid-cols-2 gap-2"
          aria-label={t('Записанные повторы', 'Жазылған қайталаулар')}
        >
          {gesture.takes.map((_, i) => (
            <TakeCard
              key={`${gesture.id}-${String(i)}-${String(gesture.takes.length)}`}
              gesture={gesture}
              index={i}
              quality={isReady(gesture) ? quality[i] : undefined}
              t={t}
              onDelete={() => { if (canEdit) library.removeTake(gesture.id, i).catch(onError); }}
            />
          ))}
        </ul>
      ) : null}
      {problems ? (
        <p className="text-sm text-ink-muted">
          {t(
            'Повторы с пометкой лучше удалить и записать заново: так жест будет распознаваться точнее.',
            'Белгіленген қайталауларды жойып, қайта жазған дұрыс: сонда ым дәлірек танылады.',
          )}
        </p>
      ) : null}
    </div>
  );
}

function SetOverview({
  lib,
  gestures,
  setId,
  open,
  setArmed,
  match,
  onError,
  t,
}: {
  lib: LibrarySnapshot;
  gestures: LibraryGesture[];
  setId: string;
  open: (id: string) => void;
  setArmed: (a: Armed | null) => void;
  match: GestureMatch | null;
  onError: (e: unknown) => void;
  t: T;
}) {
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputId = useId();
  const setName_ = lib.sets.find((s) => s.id === setId)?.name ?? '';
  const currentSet = lib.sets.find((s) => s.id === setId);
  const canEdit = currentSet?.scope !== 'global' || lib.isAdmin;

  const add = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = clean(name);
    const problem = !trimmed
      ? t('Напишите значение жеста.', 'Ымның мағынасын жазыңыз.')
      : gestures.some((g) => lower(g.name) === lower(trimmed))
        ? t('В этом наборе уже есть такой жест.', 'Бұл жинақта мұндай ым бар.')
        : gestures.length >= MAX_GESTURES
          ? t(`Не больше ${MAX_GESTURES} жестов.`, `${MAX_GESTURES} ымнан аспауы керек.`)
          : null;
    setFormError(problem);
    if (problem) return;
    setBusy(true);
    (currentSet?.scope === 'global' ? library.createGlobal(trimmed, setId) : library.create(trimmed, setId))
      .then((gesture) => {
        setName('');
        open(gesture.id);
        setArmed({ id: gesture.id, untilReady: true });
      })
      .catch((error: unknown) => {
        setFormError(errorText(error, t));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const ready = gestures.filter(isReady);
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold">{setName_}</h3>
      {canEdit ? <form onSubmit={add} className="space-y-1.5" noValidate>
        <label htmlFor={inputId} className="block text-sm font-medium">
          {t('Новый жест — что он значит', 'Жаңа ым — мағынасы')}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            maxLength={MAX_NAME_LENGTH}
            placeholder={t('Например: привет', 'Мысалы: сәлем')}
            aria-invalid={formError ? true : undefined}
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-sm placeholder:text-ink-muted/70"
            disabled={busy}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {t('Добавить', 'Қосу')}
          </Button>
        </div>
        {formError ? <p className="text-sm text-danger">{formError}</p> : null}
      </form> : null}

      {ready.length ? (
        <div aria-live="polite" data-testid="teach-status" className="space-y-2">
          <p className="text-sm text-ink-muted">
            {t(
              'Покажите любой жест набора, чтобы проверить, как он распознаётся.',
              'Қалай танылатынын тексеру үшін жинақтың кез келген ымын көрсетіңіз.',
            )}
          </p>
          <MatchResult match={match} compact />
        </div>
      ) : null}

      {gestures.length ? (
        <ul
          className="divide-y divide-line rounded-xl border border-line"
          aria-label={t('Жесты набора', 'Жинақ ымдары')}
        >
          {gestures.map((g) => {
            const problems = isReady(g)
              ? library.quality(g).filter((q) => q.verdict !== 'good').length
              : 0;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted"
                  onClick={() => {
                    open(g.id);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{g.name}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                      <TakeDots count={g.takes.length} />
                      {g.takes.length}/{MAX_TAKES} {t('повторов', 'қайталау')}
                      {g.stale
                        ? t(' · запишите заново', ' · қайта жазыңыз')
                        : !isReady(g)
                          ? t(` · нужно ${MIN_TAKES}`, ` · ${MIN_TAKES} қажет`)
                          : problems
                            ? t(
                                ` · проверьте повторы: ${problems}`,
                                ` · қайталауларды тексеріңіз: ${problems}`,
                              )
                            : ''}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-accent">{t('Открыть', 'Ашу')} →</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">
          {t(
            `В наборе пока нет жестов. Напишите значение и покажите жест ${MIN_TAKES}–${MAX_TAKES} раз.`,
            `Жинақта әзір ым жоқ. Мағынасын жазып, ымды ${MIN_TAKES}–${MAX_TAKES} рет көрсетіңіз.`,
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          {gestures.length}/{MAX_GESTURES}{' '}
          {t(
            'жестов · в аккаунте хранятся числовые признаки и скелет движения, без видео',
            'ым · аккаунтта бейне емес, сандық белгілер мен қимыл қаңқасы сақталады',
          )}
        </span>
        {gestures.length ? (
          confirmClear ? (
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmClear(false);
                  setArmed(null);
                  library.clear(setId).catch(onError);
                }}
              >
                {t('Удалить все жесты набора', 'Жинақтың барлық ымын жою')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmClear(false);
                }}
              >
                {t('Отмена', 'Болдырмау')}
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirmClear(true);
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('Очистить набор', 'Жинақты тазалау')}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

function Editor({ session, lib, t }: { session: Session; lib: LibrarySnapshot; t: T }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [armed, setArmedState] = useState<Armed | null>(null);
  const [match, setMatch] = useState<GestureMatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const armedRef = useRef(armed);
  const saving = useRef(false);
  const setId = lib.activeSetId ?? '';
  const setArmed = (a: Armed | null) => {
    armedRef.current = a;
    setArmedState(a);
    setMatch(null);
    session.resetRecognition();
  };
  const onError = (e: unknown) => {
    setNotice(errorText(e, t));
  };

  useEffect(
    () =>
      session.onResult((result) => {
        const a = armedRef.current;
        if (!a) {
          setMatch(library.match(result.inference.embedding));
          return;
        }
        if (saving.current) return;
        saving.current = true;
        library
          .addTake(a.id, result.inference.embedding, makePreview(result.segment))
          .then((updated) => {
            const n = updated?.takes.length ?? 0;
            if (!a.untilReady || n >= MIN_TAKES || n >= MAX_TAKES) {
              armedRef.current = null;
              setArmedState(null);
            }
          })
          .catch((error: unknown) => {
            setNotice(errorText(error, t));
            armedRef.current = null;
            setArmedState(null);
          })
          .finally(() => {
            saving.current = false;
          });
      }),
    [session, t],
  );

  const gestures = lib.gestures.filter((g) => g.setId === setId);
  const opened = lib.gestures.find((g) => g.id === openId);
  // Closing the open gesture when it was deleted or the set changed.
  const [shownSet, setShownSet] = useState(setId);
  if (shownSet !== setId) {
    setShownSet(setId);
    if (opened && opened.setId !== setId) setOpenId(null);
    setMatch(null);
  }

  return (
    <div className="space-y-4">
      {opened ? (
        <GestureDetail
          gesture={opened}
          lib={lib}
          armed={armed}
          setArmed={setArmed}
          match={match}
          onBack={() => {
            setOpenId(null);
            setArmed(null);
          }}
          onError={onError}
          t={t}
        />
      ) : (
        <SetOverview
          lib={lib}
          gestures={gestures}
          setId={setId}
          open={(id) => {
            setOpenId(id);
            setMatch(null);
          }}
          setArmed={setArmed}
          match={match}
          onError={onError}
          t={t}
        />
      )}
      {lib.imported ? (
        <p className="text-sm text-success">
          {t(
            `Перенесено в аккаунт из этого браузера: ${lib.imported}.`,
            `Осы браузерден аккаунтқа көшірілді: ${lib.imported}.`,
          )}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-warn">{notice}</p> : null}
    </div>
  );
}

/** "My gestures": sets of the user's own gestures, each gesture with its recorded takes. */
export default function GesturePage({ session }: { session: Session }) {
  const { t } = useLocale();
  const lib = useGestureLibrary();
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.warmUp();
    session.setRecognitionEnabled(true);
    return () => {
      session.stopCamera();
      session.setRecognitionEnabled(false);
    };
  }, [session]);
  const letters = (bukvaLabels as { ru: string }[])
    .map((l) => l.ru)
    .filter((l) => l !== 'no')
    .sort((a, b) => a.localeCompare(b, 'ru'));
  return (
    <>
      <p className="page-intro">
        {t(
          'Разделите жесты по наборам — например, казахский и русский жестовый язык. В каждом жесте можно посмотреть записанные повторы, проверить их, удалить неудачные и записать новые. Жесты хранятся в аккаунте и работают в распознавании и в видеозвонках на любом устройстве.',
          'Ымдарды жинақтарға бөліңіз — мысалы, қазақ және орыс ым тілі. Әр ымда жазылған қайталауларды көріп, тексеріп, сәтсіздерін жойып, жаңасын жазуға болады. Ымдар аккаунтта сақталады және кез келген құрылғыда тануда және бейнеқоңырауда жұмыс істейді.',
        )}
      </p>
      <LibraryGate lib={lib}>
        <div className="space-y-4">
          <SetBar lib={lib} t={t} />
          <div className="native-grid">
            <Stage session={session} snap={snap} allowReplay={false} />
            <Card className="p-5">
              <ModelGate
                state={snap.model}
                onRetry={() => {
                  void session.loadModel();
                }}
              >
                {() => <Editor session={session} lib={lib} t={t} />}
              </ModelGate>
            </Card>
          </div>
        </div>
      </LibraryGate>
      <h2 className="examples-heading">
        {t('Русский алфавит (дактиль РЖЯ)', 'Орыс әліпбиі (РЖЯ дактилі)')}
      </h2>
      <p className="page-intro">
        {t(
          'Буквы распознаются готовой моделью на устройстве, обучать их не нужно. Показывайте слово по буквам — оно соберётся в текст.',
          'Әріптерді құрылғыдағы дайын модель таниды, оларды үйретудің қажеті жоқ. Сөзді әріппен көрсетіңіз — ол мәтінге жиналады.',
        )}
      </p>
      <p className="alphabet-strip" style={{ fontSize: '1.4rem', letterSpacing: '0.35em' }}>
        {letters.join(' ')}
      </p>
      <a
        className="text-link"
        href="#recognition"
        onClick={() => {
          setRecognitionPreferences({ signLanguage: 'bukva' });
        }}
      >
        {t('Распознавать алфавит', 'Әліпбиді тану')} →
      </a>
    </>
  );
}
