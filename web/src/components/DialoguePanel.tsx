import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, Square, Mic, Copy, Expand, X } from 'lucide-react';
import { useLocale, type Locale } from '../locale';
import { Button, Card } from './ui';
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function DialoguePanel({
  text,
  setText,
  output,
}: {
  text: string;
  setText: (v: string) => void;
  output: Locale;
}) {
  const { t } = useLocale();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const display = useRef<HTMLDialogElement | null>(null);
  const stopInput = useCallback(() => {
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      current.abort();
    }
    setListening(false);
  }, []);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const speechCtor =
    (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  useEffect(() => {
    if (!speechAvailable) return;
    const refresh = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refresh);
      window.speechSynthesis.cancel();
    };
  }, [speechAvailable]);
  useEffect(() => {
    const abort = () => {
      stopInput();
      if (speechAvailable) window.speechSynthesis.cancel();
      setListening(false);
    };
    document.addEventListener('visibilitychange', abort);
    return () => {
      document.removeEventListener('visibilitychange', abort);
      abort();
    };
  }, [output, speechAvailable, stopInput]);
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(output));
  const speak = () => {
    setNotice('');
    const value = text.trim();
    if (!value) return;
    if (!speechAvailable) {
      setNotice(
        t('Озвучивание недоступно в этом браузере.', 'Бұл браузерде дыбыстау қолжетімсіз.'),
      );
      return;
    }
    const voice = matching[0];
    if (!voice) {
      setNotice(
        t(
          `Голос ${output === 'kk' ? 'казахского' : 'русского'} языка не установлен. Установите его в Windows или используйте текст.`,
          `${output === 'kk' ? 'Қазақ' : 'Орыс'} тілінің дауысы орнатылмаған. Оны Windows жүйесіне орнатыңыз немесе мәтінді қолданыңыз.`,
        ),
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = output === 'kk' ? 'kk-KZ' : 'ru-RU';
    utterance.voice = voice;
    utterance.onerror = () => {
      setNotice(t('Не удалось озвучить сообщение.', 'Хабарламаны дыбыстау мүмкін болмады.'));
    };
    window.speechSynthesis.speak(utterance);
    setHistory((h) => [value, ...h].slice(0, 5));
  };
  const listen = () => {
    setNotice('');
    if (!speechCtor || !consent) return;
    const r = new speechCtor();
    recognition.current = r;
    r.lang = output === 'kk' ? 'kk-KZ' : 'ru-RU';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      if (recognition.current !== r) return;
      const value = e.results[0]?.[0]?.transcript;
      if (value) setText(value);
    };
    r.onerror = (e) => {
      if (recognition.current !== r) return;
      setNotice(t('Распознавание речи недоступно: ', 'Сөйлеуді тану қолжетімсіз: ') + e.error);
      setListening(false);
    };
    r.onend = () => {
      if (recognition.current !== r) return;
      recognition.current = null;
      setListening(false);
    };
    try {
      r.start();
      setListening(true);
    } catch {
      setNotice(t('Не удалось включить микрофон.', 'Микрофонды қосу мүмкін болмады.'));
    }
  };
  return (
    <Card className="dialogue-panel p-5 sm:p-6">
      <div className="section-title">
        <div>
          <h2>{t('Ваше сообщение', 'Сіздің хабарламаңыз')}</h2>
        </div>
      </div>
      <label htmlFor="dialogue-text" className="field-label">
        {t('Текст сообщения', 'Хабарлама мәтіні')}
      </label>
      <textarea
        id="dialogue-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        maxLength={1000}
        rows={3}
        lang={output}
        placeholder={t('Напишите или выберите результат…', 'Жазыңыз немесе нәтижені таңдаңыз…')}
      />
      <div className="quick-phrases" aria-label={t('Быстрые фразы', 'Жылдам сөйлемдер')}>
        {[
          ['Здравствуйте', 'Сәлеметсіз бе'],
          ['Спасибо', 'Рақмет'],
          ['Мне нужна помощь', 'Маған көмек керек'],
        ].map((pair) => (
          <button
            key={pair[0]}
            onClick={() => {
              setText(pair[output === 'kk' ? 1 : 0] ?? '');
            }}
          >
            {pair[output === 'kk' ? 1 : 0]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button variant="primary" onClick={speak} disabled={!text.trim()}>
          <Volume2 size={17} aria-hidden />
          {t('Подтвердить и озвучить', 'Растау және дыбыстау')}
        </Button>
        <Button
          onClick={() => {
            if (speechAvailable) window.speechSynthesis.cancel();
          }}
        >
          <Square size={15} aria-hidden />
          {t('Стоп', 'Тоқтату')}
        </Button>
        <Button
          onClick={() => {
            setText('');
            setHistory([]);
            setNotice('');
          }}
        >
          {t('Очистить', 'Тазарту')}
        </Button>
      </div>
      <div className="message-tools">
        <button
          disabled={!text.trim()}
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => {
                setNotice(t('Текст скопирован.', 'Мәтін көшірілді.'));
              })
              .catch(() => {
                setNotice(
                  t('Выделите и скопируйте текст вручную.', 'Мәтінді белгілеп, қолмен көшіріңіз.'),
                );
              });
          }}
        >
          <Copy size={15} aria-hidden />
          {t('Копировать', 'Көшіру')}
        </button>
        <button disabled={!text.trim()} onClick={() => display.current?.showModal()}>
          <Expand size={15} aria-hidden />
          {t('Показать крупно', 'Ірі көрсету')}
        </button>
      </div>
      {!matching.length ? (
        <p className="model-note mt-3">
          {t(
            'Для озвучивания нужен установленный голос выбранного языка.',
            'Дыбыстау үшін таңдалған тілдің дауысы орнатылуы керек.',
          )}
        </p>
      ) : null}
      <details className="speech-details">
        <summary>{t('Ответить голосом → субтитры', 'Дауыспен жауап беру → субтитр')}</summary>
        <p className="model-note">
          {t(
            'Сервис браузера может отправлять аудио в облако. Поддержка ru-RU и kk-KZ зависит от браузера. Текстовый ввод работает без этого сервиса.',
            'Браузер қызметі аудионы бұлтқа жіберуі мүмкін. ru-RU және kk-KZ қолдауы браузерге байланысты. Мәтін енгізу бұл қызметсіз жұмыс істейді.',
          )}
        </p>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (!e.target.checked) {
                stopInput();
                setListening(false);
              }
            }}
          />
          {t(
            'Разрешаю облачное распознавание речи браузером',
            'Браузердің бұлттық сөйлеуді тану қызметіне келісемін',
          )}
        </label>
        <Button
          disabled={!speechCtor || !consent}
          onClick={() => {
            if (listening) {
              stopInput();
              setListening(false);
            } else listen();
          }}
        >
          <Mic size={17} aria-hidden />
          {listening ? t('Остановить микрофон', 'Микрофонды тоқтату') : t('Говорить', 'Сөйлеу')}
        </Button>
        {!speechCtor ? (
          <p>
            {t(
              'В этом браузере нет распознавания речи. Используйте Chrome или Edge и проверьте поддержку языка.',
              'Бұл браузерде сөйлеуді тану жоқ. Chrome немесе Edge қолданып, тіл қолдауын тексеріңіз.',
            )}
          </p>
        ) : null}
      </details>
      <p role="status" className="model-note">
        {listening ? t('Микрофон включён…', 'Микрофон қосулы…') : notice}
      </p>
      {history.length ? (
        <div className="confirmed-history">
          <h3>{t('Подтверждённые сообщения', 'Расталған хабарламалар')}</h3>
          <ol>
            {history.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <dialog
        ref={display}
        className="large-message"
        aria-label={t('Сообщение крупным текстом', 'Ірі мәтінді хабарлама')}
      >
        <button
          className="dialog-close"
          onClick={() => display.current?.close()}
          aria-label={t('Закрыть', 'Жабу')}
        >
          <X aria-hidden />
        </button>
        <p lang={output}>{text}</p>
      </dialog>
    </Card>
  );
}
