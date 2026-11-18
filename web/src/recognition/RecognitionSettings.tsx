import type { ReactNode } from 'react';
import { useLocale, type Locale } from '../locale';
import { useRecognitionPreferences, setRecognitionPreferences } from './preferences';
import { useConversationSpeech } from '../conversation/useSpeech';
import { recognitionFactory } from '../conversation/captions';
import { Button } from '../components/ui';
function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="settings-field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {children}
      </select>
    </label>
  );
}
export function RecognitionSettings() {
  const { t } = useLocale();
  const p = useRecognitionPreferences();
  return (
    <section className="content-card recognition-settings">
      <h2>{t('Распознавание жестов', 'Ымды тану')}</h2>
      <Choice
        label={t('Что распознавать по умолчанию', 'Әдепкі бойынша нені тану')}
        value={p.signLanguage}
        onChange={(v) => {
          setRecognitionPreferences({ signLanguage: v as typeof p.signLanguage });
        }}
      >
        <option value="personal">{t('Свои жесты', 'Өз ымдарым')}</option>
        <option value="bukva">{t('Русский алфавит (дактиль)', 'Орыс әліпбиі (дактиль)')}</option>
      </Choice>
      <label className="setting-row">
        <span>
          <b>{t('Скелет на камере', 'Камерадағы қаңқа')}</b>
          <small>
            {t(
              'Точки рук и тела поверх видео при распознавании своих жестов.',
              'Өз ымдарыңызды танығанда бейне үстіндегі қол мен дене нүктелері.',
            )}
          </small>
        </span>
        <input
          type="checkbox"
          checked={p.showSkeleton}
          onChange={(e) => {
            setRecognitionPreferences({ showSkeleton: e.target.checked });
          }}
        />
      </label>
      <label className="setting-row">
        <span>
          <b>{t('Зеркальное изображение', 'Айна бейнесі')}</b>
          <small>
            {t(
              'Только вид камеры на экране. Исходная запись не меняется.',
              'Тек экрандағы камера көрінісі. Бастапқы жазба өзгермейді.',
            )}
          </small>
        </span>
        <input
          type="checkbox"
          checked={p.mirror}
          onChange={(e) => {
            setRecognitionPreferences({ mirror: e.target.checked });
          }}
        />
      </label>
      <a className="text-link" href="#recognition">
        {t('Перейти к распознаванию', 'Тануға өту')} →
      </a>
    </section>
  );
}
export function SpeechSettings({
  language,
  setLanguage,
}: {
  language: Locale;
  setLanguage: (value: Locale) => void;
}) {
  const { t } = useLocale();
  const p = useRecognitionPreferences();
  const speech = useConversationSpeech(language, () => {});
  return (
    <section className="content-card">
      <h2>{t('Речь и субтитры', 'Сөйлеу және субтитрлер')}</h2>
      <Choice
        label={t('Язык текста и речи', 'Мәтін мен сөйлеу тілі')}
        value={language}
        onChange={(v) => {
          setLanguage(v as Locale);
        }}
      >
        <option value="ru">Русский</option>
        <option value="kk">Қазақша</option>
      </Choice>
      <Choice
        label={t('Скорость озвучивания', 'Дыбыстау жылдамдығы')}
        value={p.speechRate}
        onChange={(v) => {
          setRecognitionPreferences({ speechRate: Number(v) as typeof p.speechRate });
        }}
      >
        <option value="0.8">{t('Медленнее', 'Баяуырақ')}</option>
        <option value="1">{t('Обычная', 'Қалыпты')}</option>
        <option value="1.2">{t('Быстрее', 'Жылдамырақ')}</option>
      </Choice>
      <Button
        onClick={() => {
          speech.speak(
            language === 'kk'
              ? 'Сәлем! Менің хабарламамды тыңдаңыз.'
              : 'Здравствуйте! Это проверка озвучивания.',
          );
        }}
      >
        {t('Проверить озвучивание', 'Дыбыстауды тексеру')}
      </Button>
      <p role="status">{speech.notice}</p>
      <p>
        {recognitionFactory()
          ? t(
              'Браузер поддерживает запуск субтитров. Доступ и качество выбранного языка проверяются при включении микрофона.',
              'Браузер субтитрді іске қосуды қолдайды. Таңдалған тілдің қолжетімділігі мен сапасы микрофон қосылғанда тексеріледі.',
            )
          : t(
              'В этом браузере нет распознавания речи. Текстовый ввод остаётся доступен.',
              'Бұл браузерде сөйлеуді тану жоқ. Мәтін енгізу қолжетімді.',
            )}
      </p>
      <p>
        {t(
          'Звук не включается автоматически. Субтитры могут передавать аудио провайдеру браузера; казахский голос и распознавание зависят от системы.',
          'Дыбыс автоматты қосылмайды. Субтитр аудионы браузер провайдеріне жіберуі мүмкін; қазақша дауыс пен тану жүйеге байланысты.',
        )}
      </p>
    </section>
  );
}
