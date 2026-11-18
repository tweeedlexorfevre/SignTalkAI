import { useEffect } from 'react';
import { Hand, Smile } from 'lucide-react';
import type { Session } from '../app/session';
import type { Locale } from '../locale';
import { useLocale } from '../locale';
import { CloudPanel } from '../cloud/CloudPanel';
import { NativePanel } from '../components/NativePanel';
import { AslWorkspace } from '../components/AslWorkspace';
import { FingerspellPanel } from '../components/FingerspellPanel';
import { useRecognitionPreferences, setRecognitionPreferences } from '../recognition/preferences';
import { ResultEditor } from '../recognition/ResultEditor';
import { LipReadPanel } from '../lipread/LipReadPanel';
export default function RecognitionPage({
  session,
  language,
  setLanguage,
  model,
  onPick,
}: {
  session: Session;
  language: Locale;
  setLanguage: (value: Locale) => void;
  model: string;
  onPick: (text: string) => void;
}) {
  const { t } = useLocale();
  const prefs = useRecognitionPreferences();
  const { signLanguage: profile, engine, method } = prefs;
  const composer = <ResultEditor language={language} />;
  useEffect(() => {
    session.stopCamera();
    session.stopReplay();
    if (method === 'lips') return;
    if (engine === 'local') session.warmUp();
    session.setRecognitionEnabled(engine === 'local' && profile === 'asl');
    return () => {
      session.stopCamera();
      session.stopReplay();
      session.setRecognitionEnabled(false);
    };
  }, [session, engine, profile, method]);
  const methodSwitch = (
    <div
      className="engine-switch method-switch"
      role="group"
      aria-label={t('Что распознавать', 'Нені тану')}
    >
      <button
        aria-pressed={method === 'signs'}
        onClick={() => {
          setRecognitionPreferences({ method: 'signs' });
        }}
      >
        <Hand size={17} aria-hidden />
        {t('Язык жестов', 'Ым тілі')}
      </button>
      <button
        aria-pressed={method === 'lips'}
        onClick={() => {
          setRecognitionPreferences({ method: 'lips' });
        }}
      >
        <Smile size={17} aria-hidden />
        {t('Чтение по губам', 'Ерін оқу')}
      </button>
    </div>
  );
  if (method === 'lips') {
    return (
      <>
        {methodSwitch}
        <LipReadPanel onPick={onPick} composer={composer} />
      </>
    );
  }
  return (
    <>
      {methodSwitch}
      <div className="experiment-note">
        <b>{t('Жест → текст → озвучивание', 'Ым → мәтін → дыбыстау')}</b>
        <p>
          {t(
            'Покажите один жест, проверьте результат и озвучьте его. Начните со словаря KRSL: примеры и названия общие для облачного и локального режимов. Распознавание может ошибаться.',
            'Бір ым көрсетіңіз, нәтижені тексеріп, дыбыстаңыз. KRSL сөздігінен бастаңыз: бұлттық және жергілікті режимдердің мысалдары мен атаулары ортақ. Тану қате болуы мүмкін.',
          )}
        </p>
        <a href="#gestures">{t('Какие жесты можно показать', 'Қандай ым көрсетуге болады')} →</a>
      </div>
      <div className="conversation-toolbar">
        <div
          className="engine-switch"
          role="group"
          aria-label={t('Способ распознавания', 'Тану тәсілі')}
        >
          <button
            aria-pressed={engine === 'cloud'}
            onClick={() => {
              setRecognitionPreferences({ engine: 'cloud' });
            }}
          >
            {t('Облачный ИИ', 'Бұлттық ЖИ')}
          </button>
          <button
            aria-pressed={engine === 'local'}
            onClick={() => {
              setRecognitionPreferences({ engine: 'local' });
            }}
          >
            {t('На устройстве', 'Құрылғыда')}
          </button>
        </div>
        {profile === 'bukva' && engine === 'cloud' ? (
          <p className="inline-note">
            {t('Алфавит распознаётся только на устройстве.', 'Әліпби тек құрылғыда танылады.')}
          </p>
        ) : null}
        <label className="inline-setting">
          <span>{t('Жестовый язык / модель', 'Ым тілі / модель')}</span>
          <select
            value={profile}
            aria-label={t('Жестовый язык / модель', 'Ым тілі / модель')}
            onChange={(e) => {
              setRecognitionPreferences({ signLanguage: e.target.value as typeof profile });
            }}
          >
            <option value="krsl">{t('Казахстан · KRSL', 'Қазақстан · KRSL')}</option>
            <option value="rsl">{t('Русский жестовый · РЖЯ', 'Орыс ым тілі · РЖЯ')}</option>
            <option value="bukva">{t('Дактиль РЖЯ · алфавит', 'РЖЯ дактилі · әліпби')}</option>
            <option value="asl">
              {t('KRSL (тестовая подпись · модель ASL)', 'KRSL (сынақ белгісі · ASL моделі)')}
            </option>
          </select>
        </label>
        {engine === 'cloud' && profile === 'krsl' ? (
          <label className="inline-setting">
            <span>{t('Словарь облака', 'Бұлт сөздігі')}</span>
            <select
              value={prefs.vocabulary}
              aria-label={t('Словарь облака', 'Бұлт сөздігі')}
              onChange={(e) => {
                setRecognitionPreferences({ vocabulary: e.target.value as 'krsl10' | 'free' });
              }}
            >
              <option value="krsl10">{t('KRSL · 10 жестов', 'KRSL · 10 ым')}</option>
              <option value="free">{t('Свободный · эксперимент', 'Еркін · тәжірибе')}</option>
            </select>
          </label>
        ) : null}
        <label className="inline-setting">
          <span>{t('Язык текста и озвучивания', 'Мәтін және дыбыстау тілі')}</span>
          <select
            value={language}
            aria-label={t('Язык текста и озвучивания', 'Мәтін және дыбыстау тілі')}
            onChange={(e) => {
              setLanguage(e.target.value as Locale);
            }}
          >
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
          </select>
        </label>
        <a href="#gestures" className="text-link">
          {t('Словарь и примеры', 'Сөздік және мысалдар')}
        </a>
        <a href="#settings" className="text-link">
          {t('Настройки распознавания', 'Тану баптаулары')}
        </a>
      </div>
      {profile === 'bukva' ? (
        <FingerspellPanel session={session} onPick={onPick} composer={composer} />
      ) : engine === 'cloud' ? (
        <CloudPanel
          key={`${profile}-${language}-${model}-${prefs.vocabulary}`}
          language={profile}
          output={language}
          model={model}
          onPick={onPick}
          composer={composer}
        />
      ) : profile === 'asl' ? (
        <>
          <AslWorkspace session={session} output={language} onPick={onPick} />
          {composer}
        </>
      ) : (
        <NativePanel
          key={`${profile}-${language}`}
          kind={profile}
          session={session}
          output={language}
          onPick={onPick}
          composer={composer}
        />
      )}
    </>
  );
}
