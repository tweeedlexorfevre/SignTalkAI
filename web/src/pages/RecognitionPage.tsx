import { useEffect } from 'react';
import { CaseSensitive, Hand } from 'lucide-react';
import type { Session } from '../app/session';
import type { Locale } from '../locale';
import { useLocale } from '../locale';
import { FingerspellPanel } from '../components/FingerspellPanel';
import { PersonalWorkspace } from '../gestures/PersonalWorkspace';
import { useRecognitionPreferences, setRecognitionPreferences } from '../recognition/preferences';
import { ResultEditor } from '../recognition/ResultEditor';
export default function RecognitionPage({
  session,
  language,
  setLanguage,
  onPick,
}: {
  session: Session;
  language: Locale;
  setLanguage: (value: Locale) => void;
  onPick: (text: string) => void;
}) {
  const { t } = useLocale();
  const { signLanguage: profile } = useRecognitionPreferences();
  const composer = <ResultEditor language={language} />;
  useEffect(() => {
    session.stopCamera();
    session.stopReplay();
    if (profile === 'personal') session.warmUp();
    // Own gestures are read by the continuous spotter (gestures/spotter.ts), not the session's recogniser.
    session.setRecognitionEnabled(false);
    return () => {
      session.stopCamera();
      session.stopReplay();
      session.setRecognitionEnabled(false);
    };
  }, [session, profile]);
  return (
    <>
      <div className="conversation-toolbar">
        <div
          className="engine-switch method-switch"
          role="group"
          aria-label={t('Что распознавать', 'Нені тану')}
        >
          <button
            aria-pressed={profile === 'personal'}
            onClick={() => {
              setRecognitionPreferences({ signLanguage: 'personal' });
            }}
          >
            <Hand size={17} aria-hidden />
            {t('Свои жесты', 'Өз ымдарым')}
          </button>
          <button
            aria-pressed={profile === 'bukva'}
            onClick={() => {
              setRecognitionPreferences({ signLanguage: 'bukva' });
            }}
          >
            <CaseSensitive size={17} aria-hidden />
            {t('Русский алфавит', 'Орыс әліпбиі')}
          </button>
        </div>
        <label className="inline-setting">
          <span>{t('Язык озвучивания', 'Дыбыстау тілі')}</span>
          <select
            value={language}
            aria-label={t('Язык озвучивания', 'Дыбыстау тілі')}
            onChange={(e) => {
              setLanguage(e.target.value as Locale);
            }}
          >
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
          </select>
        </label>
        <a href="#gestures" className="text-link">
          {t('Мои жесты', 'Менің ымдарым')}
        </a>
        <a href="#settings" className="text-link">
          {t('Настройки', 'Баптаулар')}
        </a>
      </div>
      {profile === 'bukva' ? (
        <FingerspellPanel session={session} onPick={onPick} composer={composer} />
      ) : (
        <>
          <PersonalWorkspace session={session} />
          {composer}
        </>
      )}
    </>
  );
}
