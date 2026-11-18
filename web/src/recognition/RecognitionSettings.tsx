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
        label={t('Жестовый язык по умолчанию', 'Әдепкі ым тілі')}
        value={p.signLanguage}
        onChange={(v) => {
          setRecognitionPreferences({ signLanguage: v as typeof p.signLanguage });
        }}
      >
        <option value="krsl">{t('Казахстан · KRSL', 'Қазақстан · KRSL')}</option>
        <option value="rsl">{t('Русский жестовый · РЖЯ', 'Орыс ым тілі · РЖЯ')}</option>
        <option value="bukva">{t('Дактиль РЖЯ · алфавит', 'РЖЯ дактилі · әліпби')}</option>
        <option value="asl">{t('ASL', 'ASL')}</option>
      </Choice>
      <Choice
        label={t('Способ распознавания по умолчанию', 'Әдепкі тану тәсілі')}
        value={p.engine}
        onChange={(v) => {
          setRecognitionPreferences({ engine: v as typeof p.engine });
        }}
      >
        <option value="cloud">{t('Облачный ИИ', 'Бұлттық ЖИ')}</option>
        <option value="local">{t('На устройстве', 'Құрылғыда')}</option>
      </Choice>
      <Choice
        label={t('Словарь облака для KRSL', 'KRSL үшін бұлт сөздігі')}
        value={p.vocabulary}
        onChange={(v) => {
          setRecognitionPreferences({ vocabulary: v as typeof p.vocabulary });
        }}
      >
        <option value="krsl10">{t('10 жестов · как в примерах', 'Мысалдардағы 10 ым')}</option>
        <option value="free">{t('Свободный · эксперимент', 'Еркін · тәжірибе')}</option>
      </Choice>
      <p>
        {t(
          'Словарь задаёт допустимые названия ответа, но не обучает модель движениям. Для РЖЯ и ASL облако работает в свободном режиме.',
          'Сөздік жауаптың рұқсат етілген атауларын белгілейді, бірақ модельге қимылды үйретпейді. РЖЯ және ASL үшін бұлт еркін режимде жұмыс істейді.',
        )}
      </p>
      <Choice
        label={t('Время на подготовку', 'Дайындық уақыты')}
        value={p.countdown}
        onChange={(v) => {
          setRecognitionPreferences({ countdown: Number(v) as typeof p.countdown });
        }}
      >
        {[1, 3, 5].map((n) => (
          <option key={n} value={n}>
            {n} {t('сек.', 'сек.')}
          </option>
        ))}
      </Choice>
      <Choice
        label={t('Длительность облачной записи', 'Бұлтқа арналған жазба ұзақтығы')}
        value={p.cloudSeconds}
        onChange={(v) => {
          setRecognitionPreferences({ cloudSeconds: Number(v) as typeof p.cloudSeconds });
        }}
      >
        {[3, 5, 8].map((n) => (
          <option key={n} value={n}>
            {n} {t('сек.', 'сек.')}
          </option>
        ))}
      </Choice>
      <p>
        {t(
          'Отсчёт относится к ручной записи. ASL на устройстве выделяет жест автоматически; локальные модели используют свою фиксированную длину записи.',
          'Кері санау қолмен жазуға арналған. Құрылғыдағы ASL ымды автоматты бөледі; жергілікті модельдер жазбаның өз тұрақты ұзақтығын қолданады.',
        )}
      </p>
      <label className="setting-row">
        <span>
          <b>{t('Скелет на камере', 'Камерадағы қаңқа')}</b>
          <small>
            {t(
              'Облако, KRSL и ASL на устройстве. Локальная РЖЯ работает с видео. На точность облака не влияет.',
              'Бұлт, құрылғыдағы KRSL және ASL. Жергілікті РЖЯ бейнемен жұмыс істейді. Бұлт дәлдігіне әсер етпейді.',
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
