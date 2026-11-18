import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Session } from '../app/session';
import { useLocale, type Locale } from '../locale';
import { Stage } from './Stage';
import { ModelGate } from './ModelGate';
import { ModeTabs, type Mode } from './ModeTabs';
import { PracticePanel } from './PracticePanel';
import { TeachPanel } from './TeachPanel';
import { Card } from './ui';
import type { RecognitionResult } from '../ml/recognizer';
import type { LoadedModel } from '../ml/model-client';
import vocabulary from '../vocabulary.json';
import type { SignLabel } from '../ml/meta';
function localLabels(labels: SignLabel[], locale: Locale): SignLabel[] {
  return labels.map((l) => ({
    ...l,
    label: (vocabulary as Record<string, Record<Locale, string>>)[l.sign]?.[locale] ?? l.label,
  }));
}
function Result({
  session,
  model,
  onPick,
}: {
  session: Session;
  model: LoadedModel;
  onPick: (v: string) => void;
}) {
  const { t } = useLocale();
  const [last, setLast] = useState<RecognitionResult | null>(null);
  useEffect(
    () =>
      session.onResult((result) => {
        setLast(result);
      }),
    [session],
  );
  const decision = last?.decision;
  return (
    <div>
      <p className="model-note">
        {t(
          'Это американский жестовый язык (ASL). Перевод подписей RU/KZ не меняет язык модели. Покажите один жест и опустите руки.',
          'Бұл — америкалық ым тілі (ASL). RU/KZ жазулары модельдің тілін өзгертпейді. Бір ым көрсетіп, қолыңызды түсіріңіз.',
        )}
      </p>
      <div className="main-result" aria-live="polite" data-testid="recognise-result">
        {!decision
          ? t('Результат появится здесь', 'Нәтиже осы жерде пайда болады')
          : decision.kind === 'sign'
            ? model.labels[decision.top[0]?.index ?? -1]?.label
            : t('Не распознано уверенно', 'Сенімді танылмады')}
      </div>
      <ol className="candidate-list">
        {decision?.top.map((g) => (
          <li key={g.index}>
            <button
              onClick={() => {
                const label = model.labels[g.index];
                if (label) onPick(label.label);
              }}
            >
              <span>{model.labels[g.index]?.label}</span>
              <b>{Math.round(g.probability * 100)}%</b>
            </button>
          </li>
        ))}
      </ol>
      {decision?.top.length ? (
        <p className="model-note">
          {t(
            'Выберите правильную гипотезу перед озвучиванием.',
            'Дыбыстаудан бұрын дұрыс болжамды таңдаңыз.',
          )}
        </p>
      ) : null}
    </div>
  );
}
export function AslWorkspace({
  session,
  output,
  onPick,
}: {
  session: Session;
  output: Locale;
  onPick: (v: string) => void;
}) {
  const { t } = useLocale();
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [mode, setMode] = useState<Mode>('recognise');
  return (
    <div className="native-grid">
      <Stage session={session} snap={snap} />
      <Card className="p-5">
        <h2 className="mb-4">{t('ASL · исходная модель', 'ASL · бастапқы модель')}</h2>
        <ModeTabs
          mode={mode}
          onChange={(v) => {
            setMode(v);
            session.resetRecognition();
          }}
        />
        <div role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`} className="mt-5">
          <ModelGate
            state={snap.model}
            onRetry={() => {
              void session.loadModel();
            }}
          >
            {(loaded) => {
              const model = { ...loaded, labels: localLabels(loaded.labels, output) };
              return mode === 'recognise' ? (
                <Result session={session} model={model} onPick={onPick} />
              ) : mode === 'practice' ? (
                <PracticePanel session={session} model={model} />
              ) : (
                <TeachPanel session={session} model={model} />
              );
            }}
          </ModelGate>
          {snap.inferenceError ? (
            <p role="alert">
              {t('Ошибка вычисления: ', 'Есептеу қатесі: ')}
              {snap.inferenceError}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
