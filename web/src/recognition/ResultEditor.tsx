import { useRef, useSyncExternalStore } from 'react';
import { Copy, Expand, Volume2, X } from 'lucide-react';
import type { Locale } from '../locale';
import { useLocale } from '../locale';
import { conversation } from '../conversation/session';
import { useConversationSpeech } from '../conversation/useSpeech';
import { Button } from '../components/ui';
export function ResultEditor({ language }: { language: Locale }) {
  const { t } = useLocale();
  const { draft } = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const speech = useConversationSpeech(language, () => {});
  const display = useRef<HTMLDialogElement | null>(null);
  return (
    <section className="content-card result-editor" aria-labelledby="result-editor-title">
      <h2 id="result-editor-title">{t('Текст и озвучивание', 'Мәтін және дыбыстау')}</h2>
      <label htmlFor="recognition-text">{t('Текст результата', 'Нәтиже мәтіні')}</label>
      <textarea
        id="recognition-text"
        rows={3}
        maxLength={1000}
        value={draft}
        lang={language}
        placeholder={t(
          'Распознанные жесты собираются здесь. Текст можно исправить.',
          'Танылған ымдар осында жиналады. Мәтінді түзетуге болады.',
        )}
        onChange={(e) => {
          conversation.setDraft(e.target.value);
        }}
      />
      <div className="result-editor-actions">
        <Button
          variant="primary"
          disabled={!draft.trim()}
          onClick={() => {
            speech.speak(draft);
          }}
        >
          <Volume2 size={17} aria-hidden />
          {t('Озвучить', 'Дыбыстау')}
        </Button>
        <Button
          disabled={!draft.trim()}
          onClick={() => {
            display.current?.showModal();
          }}
        >
          <Expand size={17} aria-hidden />
          {t('Показать крупно', 'Үлкейтіп көрсету')}
        </Button>
        <Button
          disabled={!draft.trim()}
          onClick={() => {
            const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
            if (!clipboard) {
              speech.setNotice(
                t('Выделите и скопируйте текст вручную.', 'Мәтінді қолмен таңдап, көшіріңіз.'),
              );
              return;
            }
            void clipboard
              .writeText(draft)
              .then(() => {
                speech.setNotice(t('Текст скопирован.', 'Мәтін көшірілді.'));
              })
              .catch(() => {
                speech.setNotice(
                  t(
                    'Не удалось скопировать. Выделите текст вручную.',
                    'Көшіру мүмкін болмады. Мәтінді қолмен таңдаңыз.',
                  ),
                );
              });
          }}
        >
          <Copy size={17} aria-hidden />
          {t('Копировать', 'Көшіру')}
        </Button>
        <Button
          disabled={!draft}
          onClick={() => {
            conversation.setDraft('');
          }}
        >
          <X size={17} aria-hidden />
          {t('Очистить', 'Тазалау')}
        </Button>
        <button className="text-button" onClick={speech.stopVoice}>
          {t('Стоп звук', 'Дыбысты тоқтату')}
        </button>
      </div>
      <p role="status">{speech.notice}</p>
      <dialog
        ref={display}
        className="large-message presentation"
        aria-label={t('Крупный текст результата', 'Нәтиженің үлкен мәтіні')}
      >
        <div className="presentation-actions">
          <span />
          <button onClick={() => display.current?.close()} aria-label={t('Закрыть', 'Жабу')}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <p lang={language}>{draft}</p>
      </dialog>
    </section>
  );
}
