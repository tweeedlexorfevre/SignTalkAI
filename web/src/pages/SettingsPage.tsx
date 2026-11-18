import { useState } from 'react';
import { useLocale } from '../locale';
import { MODEL_OPTIONS, cloudMessage } from '../cloud/client';
import { Button } from '../components/ui';
import { RecognitionSettings, SpeechSettings } from '../recognition/RecognitionSettings';
import type { Locale } from '../locale';
export default function SettingsPage({
  model,
  language,
  setLanguage,
  setModel,
  large,
  setLarge,
  contrast,
  setContrast,
}: {
  model: string;
  language: Locale;
  setLanguage: (value: Locale) => void;
  setModel: (v: string) => void;
  large: boolean;
  setLarge: (v: boolean) => void;
  contrast: boolean;
  setContrast: (v: boolean) => void;
}) {
  const { lang, t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
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
      <section className="content-card">
        <h2>{t('Облачное распознавание', 'Бұлттық тану')}</h2>
        <label className="settings-field">
          {t('Модель Google', 'Google моделі')}
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setNotice('');
            }}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <p>
          {t(
            'Доступ зависит от ключа и квоты Google. Проверка отправит короткий текстовый запрос без видео.',
            'Қолжетімділік Google кілті мен квотасына байланысты. Тексеру бейнесіз қысқа мәтін сұрауын жібереді.',
          )}
        </p>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice('');
            void fetch('/api/cloud/check', {
              method: 'POST',
              headers: { 'x-signtalk-consent': 'yes', 'x-signtalk-model': model },
            })
              .then(async (r) => {
                const data = (await r.json()) as { error?: string };
                setNotice(
                  r.ok
                    ? t(
                        'Подключение работает. Точность жестов проверяется отдельно.',
                        'Қосылым жұмыс істейді. Ым дәлдігі бөлек тексеріледі.',
                      )
                    : cloudMessage(data.error ?? 'network', lang),
                );
              })
              .catch(() => {
                setNotice(cloudMessage('network', lang));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? t('Проверяем…', 'Тексеруде…') : t('Проверить подключение', 'Қосылымды тексеру')}
        </Button>
        <p role="status">{notice}</p>
        <p>
          {t(
            'Ключ хранится только на сервере. Его можно заменить в .env.local и перезапустить preview-windows.cmd.',
            'Кілт тек серверде сақталады. Оны .env.local ішінде ауыстырып, preview-windows.cmd файлын қайта іске қосуға болады.',
          )}
        </p>
      </section>
    </div>
  );
}
