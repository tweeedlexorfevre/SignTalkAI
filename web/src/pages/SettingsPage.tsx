import { useLocale } from '../locale';
import { RecognitionSettings, SpeechSettings } from '../recognition/RecognitionSettings';
import type { Locale } from '../locale';
export default function SettingsPage({
  language,
  setLanguage,
  large,
  setLarge,
  contrast,
  setContrast,
}: {
  language: Locale;
  setLanguage: (value: Locale) => void;
  large: boolean;
  setLarge: (v: boolean) => void;
  contrast: boolean;
  setContrast: (v: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="settings-grid">
      <RecognitionSettings />
      <SpeechSettings language={language} setLanguage={setLanguage} />
      <section className="content-card">
        <h2>{t('Удобство чтения', 'Оқу ыңғайлылығы')}</h2>
        <label className="setting-row">
          <span>
            <b>{t('Крупный текст', 'Ірі мәтін')}</b>
            <small>
              {t('Увеличить подписи и сообщения', 'Жазулар мен хабарламаларды үлкейту')}
            </small>
          </span>
          <input
            type="checkbox"
            checked={large}
            onChange={(e) => {
              setLarge(e.target.checked);
            }}
          />
        </label>
        <label className="setting-row">
          <span>
            <b>{t('Высокий контраст', 'Жоғары контраст')}</b>
            <small>{t('Более чёткие границы и текст', 'Айқын шекаралар мен мәтін')}</small>
          </span>
          <input
            type="checkbox"
            checked={contrast}
            onChange={(e) => {
              setContrast(e.target.checked);
            }}
          />
        </label>
      </section>
    </div>
  );
}
