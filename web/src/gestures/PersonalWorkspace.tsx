import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HelpCircle, Sparkles } from 'lucide-react';
import type { Session } from '../app/session';
import { useLocale } from '../locale';
import { Stage } from '../components/Stage';
import { ModelGate } from '../components/ModelGate';
import { Button, Card, Percent } from '../components/ui';
import { conversation } from '../conversation/session';
import { MIN_TAKES, isReady, type GestureMatch } from '../ml/prototypes';
import type { LoadedModel } from '../ml/model-client';
import { library, useGestureLibrary, type LibrarySnapshot } from './library';
import { useSpotter } from './useSpotter';
import { LibraryGate, SetPicker } from './LibraryGate';

function appendToDraft(word: string) {
  const draft = conversation.getSnapshot().draft.trim();
  conversation.setDraft(draft ? `${draft} ${word}` : word);
}

/** The verdict box for one attempt; shared by recognition and the gesture editor. */
export function MatchResult({
  match,
  expected,
  onPick,
  compact = false,
}: {
  match: GestureMatch | null;
  /** A small placeholder instead of the big "result" block (in narrow panels). */
  compact?: boolean;
  /** In the editor: the gesture being checked, to say whether the answer was right. */
  expected?: string;
  onPick?: (name: string) => void;
}) {
  const { t } = useLocale();
  if ((match === null || match.kind === 'empty') && compact)
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
        {t('Результат проверки появится здесь', 'Тексеру нәтижесі осы жерде пайда болады')}
      </p>
    );
  if (match === null || match.kind === 'empty')
    return (
      <div className="main-result">
        {t('Результат появится здесь', 'Нәтиже осы жерде пайда болады')}
      </div>
    );
  if (match.kind === 'match') {
    const wrong = expected !== undefined && match.gesture.id !== expected;
    return (
      <div
        className={`rounded-xl border px-4 py-3 ${wrong ? 'border-danger/40 bg-danger-soft' : 'border-success/40 bg-success-soft'}`}
      >
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {expected === undefined
            ? t('Распознано', 'Танылды')
            : wrong
              ? t('Распознано как другой жест', 'Басқа ым ретінде танылды')
              : t('Проверка пройдена', 'Тексеруден өтті')}
        </p>
        <p className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles aria-hidden className={`size-5 ${wrong ? 'text-danger' : 'text-success'}`} />
          {match.gesture.name}
        </p>
        <p className="text-sm text-ink-muted">
          {t('Сходство', 'Ұқсастық')} <Percent value={match.similarity} />
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-surface-muted px-4 py-3">
      <p className="flex items-center gap-2 text-xl font-semibold">
        <HelpCircle aria-hidden className="size-5 text-warn" />
        {t('Не уверен', 'Сенімді емес')}
      </p>
      <p className="text-sm text-ink-muted">
        {t(
          `Ближе всего «${match.gesture.name}», но недостаточно уверенно.`,
          `Ең жақыны — «${match.gesture.name}», бірақ сенімсіз.`,
        )}
      </p>
      {onPick ? (
        <Button
          size="sm"
          className="mt-2"
          onClick={() => {
            onPick(match.gesture.name);
          }}
        >
          {t(`Это «${match.gesture.name}»`, `Бұл — «${match.gesture.name}»`)}
        </Button>
      ) : null}
    </div>
  );
}

function RecognisePanel({
  session,
  model,
  lib,
}: {
  session: Session;
  model: LoadedModel;
  lib: LibrarySnapshot;
}) {
  const { t } = useLocale();
  const [match, setMatch] = useState<GestureMatch | null>(null);
  const [signing, setSigning] = useState(false);
  const [autoAdd, setAutoAdd] = useState(true);
  const autoRef = useRef(autoAdd);
  useEffect(() => {
    autoRef.current = autoAdd;
  }, [autoAdd]);
  useSpotter(session, model, (event) => {
    if (event.type === 'activity') {
      setSigning(event.active);
      return;
    }
    const gesture = library.getSnapshot().gestures.find((g) => g.id === event.id);
    if (!gesture) return;
    if (event.type === 'word') {
      setMatch({ kind: 'match', gesture, similarity: event.similarity, runnerUp: 0 });
      if (autoRef.current) appendToDraft(event.name);
    } else {
      setMatch({ kind: 'not-sure', gesture, similarity: event.similarity, runnerUp: 0 });
    }
  });
  const [shownSet, setShownSet] = useState(lib.activeSetId);
  if (shownSet !== lib.activeSetId) {
    setShownSet(lib.activeSetId);
    setMatch(null);
  }
  const ready = lib.gestures.filter((g) => g.setId === lib.activeSetId && isReady(g));
  return (
    <div className="space-y-4">
      <SetPicker lib={lib} label={t('Набор жестов', 'Ым жинағы')} />
      {ready.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {t(
            `В этом наборе пока нет готовых жестов. Откройте «Мои жесты», добавьте жест и покажите его ${MIN_TAKES} раза.`,
            `Бұл жинақта әзір дайын ым жоқ. «Менің ымдарым» бөлімін ашып, ым қосыңыз да, оны ${MIN_TAKES} рет көрсетіңіз.`,
          )}{' '}
          <a className="text-link" href="#gestures">
            {t('Мои жесты', 'Менің ымдарым')} →
          </a>
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {t(
              'Включите камеру и показывайте жесты в обычном темпе — каждое распознанное значение сразу добавится в текст ниже.',
              'Камераны қосып, ымдарды қалыпты қарқынмен көрсетіңіз — әр танылған мағына төмендегі мәтінге бірден қосылады.',
            )}
          </p>
          <p className="text-xs text-ink-muted" aria-live="polite">
            {signing
              ? t(
                  'Читаю жесты… можно показывать подряд, без пауз.',
                  'Ымдарды оқып жатырмын… үзіліссіз қатарынан көрсетуге болады.',
                )
              : t('Жду движения рук.', 'Қол қимылын күтемін.')}
          </p>
          <div aria-live="polite" data-testid="recognise-result">
            <MatchResult match={match} onPick={appendToDraft} />
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={autoAdd}
              onChange={(e) => {
                setAutoAdd(e.target.checked);
              }}
            />
            <span>
              {t(
                'Сразу добавлять уверенный результат в текст',
                'Сенімді нәтижені бірден мәтінге қосу',
              )}
            </span>
          </label>
          <p className="text-xs text-ink-muted">
            {t('Жесты набора', 'Жинақ ымдары')}: {ready.map((g) => g.name).join(', ')}
          </p>
        </>
      )}
    </div>
  );
}

/** Camera + recognition of the user's own gestures from the chosen set. */
export function PersonalWorkspace({ session }: { session: Session }) {
  const { t } = useLocale();
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const lib = useGestureLibrary();
  return (
    <div className="native-grid">
      <Stage session={session} snap={snap} allowReplay={false} />
      <Card className="p-5">
        <h2 className="mb-4">{t('Свои жесты', 'Өз ымдарым')}</h2>
        <ModelGate
          state={snap.model}
          onRetry={() => {
            void session.loadModel();
          }}
        >
          {(loaded) => (
            <LibraryGate lib={lib}>
              <RecognisePanel session={session} model={loaded} lib={lib} />
            </LibraryGate>
          )}
        </ModelGate>
        {snap.inferenceError ? (
          <p role="alert">
            {t('Ошибка вычисления: ', 'Есептеу қатесі: ')}
            {snap.inferenceError}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
