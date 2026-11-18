import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowUp,
  Mic,
  Square,
  Volume2,
  Expand,
  X,
  RotateCw,
  MessageSquare,
  Sparkles,
  Bookmark,
  Trash2,
  GraduationCap,
} from 'lucide-react';
import type { Locale } from '../locale';
import { useLocale } from '../locale';
import { Button } from '../components/ui';
import { cloudMessage } from '../cloud/client';
import { conversation } from './session';
import { phrasesFor, readFavorites, SCENES } from './phrases';
import { useConversationSpeech } from './useSpeech';

export default function ConversationPage({
  language,
  setLanguage,
  model,
}: {
  language: Locale;
  setLanguage: (v: Locale) => void;
  model: string;
}) {
  const { lang, t } = useLocale();
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [favorites, setFavorites] = useState(() => {
    try {
      return readFavorites(localStorage.getItem('signtalk.favoritePhrases'));
    } catch {
      return [];
    }
  });
  const [phraseTab, setPhraseTab] = useState<'college' | 'saved'>('college');
  const [notice, setNotice] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [assistant, setAssistant] = useState<{ source: string; text: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const speechConsent = useRef<HTMLDialogElement | null>(null);
  const aiConsent = useRef<HTMLDialogElement | null>(null);
  const display = useRef<HTMLDialogElement | null>(null);
  const newTalk = useRef<HTMLDialogElement | null>(null);
  const partnerCard = useRef<HTMLElement | null>(null);
  const [speechApproved, setSpeechApproved] = useState(false);
  const [aiApproved, setAiApproved] = useState(false);
  const request = useRef<AbortController | null>(null);
  const ticket = useRef(0);
  const draftRef = useRef(state.draft);
  useEffect(() => {
    draftRef.current = state.draft;
  }, [state.draft]);
  const speech = useConversationSpeech(language, (text) => {
    conversation.send('partner', text, language, 'speech');
  });
  const lastMine = state.messages.findLast((m) => m.role === 'me');
  const lastPartner = state.messages.findLast((m) => m.role === 'partner');
  const view =
    lastMine?.text ??
    t(
      'Мне удобнее общаться текстом. Напишите ответ здесь или нажмите «Слушать ответ».',
      'Маған мәтінмен сөйлесу ыңғайлы. Жауапты осында жазыңыз немесе «Жауапты тыңдау» батырмасын басыңыз.',
    );
  useEffect(() => {
    const cancel = () => {
      request.current?.abort();
      ticket.current++;
      setThinking(false);
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      cancel();
    };
  }, [language]);
  const send = (text = state.draft, source: 'typed' | 'phrase' = 'typed') => {
    speech.stop();
    request.current?.abort();
    ticket.current++;
    setThinking(false);
    setNotice('');
    conversation.send('me', text, language, source);
    if (source === 'typed') conversation.setDraft('');
    setAssistant(null);
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => {
        partnerCard.current?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        });
      });
    }
  };
  const favorite = () => {
    const text = state.draft.trim();
    if (!text || text.length > 150) return;
    const next = [...new Set([text, ...favorites])].slice(0, 12);
    try {
      localStorage.setItem('signtalk.favoritePhrases', JSON.stringify(next));
      setFavorites(next);
      setNotice(t('Фраза сохранена только в этом браузере.', 'Сөйлем тек осы браузерде сақталды.'));
    } catch {
      setNotice(t('Не удалось сохранить фразу.', 'Сөйлемді сақтау мүмкін болмады.'));
    }
  };
  const helpPhrase = async () => {
    if (!state.draft.trim()) return;
    const source = state.draft;
    const number = ++ticket.current;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setThinking(true);
    setAssistant(null);
    setNotice('');
    try {
      const r = await fetch('/api/cloud/phrase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signtalk-consent': 'yes',
          'x-signtalk-model': model,
        },
        body: JSON.stringify({ text: source, language }),
        signal: controller.signal,
      });
      const data = (await r.json()) as { status?: string; text?: string; error?: string };
      if (number !== ticket.current || draftRef.current !== source) return;
      if (!r.ok) throw Error(data.error ?? 'network');
      if (data.status === 'recognized' && typeof data.text === 'string' && data.text.trim())
        setAssistant({ source, text: data.text });
      else
        setNotice(
          t(
            'Смысл неясен. Уточните фразу своими словами.',
            'Мағынасы түсініксіз. Ойыңызды нақтылаңыз.',
          ),
        );
    } catch (e) {
      if (number === ticket.current && !controller.signal.aborted)
        setNotice(cloudMessage(e instanceof Error ? e.message : 'network', lang));
    } finally {
      if (number === ticket.current) setThinking(false);
    }
  };
  const listen = () => {
    setNotice('');
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.stopVoice();
    if (speechApproved) speech.start();
    else speechConsent.current?.showModal();
  };
  const startNew = () => {
    speech.stop();
    speech.stopVoice();
    request.current?.abort();
    ticket.current++;
    setThinking(false);
    setAssistant(null);
    conversation.clear();
    setNotice('');
    newTalk.current?.close();
  };
  return (
    <div className="college-conversation">
      <div className="talk-controls">
        <div
          className="scene-picker"
          role="group"
          aria-label={t('Ситуация в колледже', 'Колледждегі жағдай')}
        >
          {SCENES.map((scene) => (
            <button
              key={scene.id}
              aria-pressed={state.scene === scene.id}
              onClick={() => {
                conversation.setScene(scene.id);
              }}
            >
              {scene[lang]}
            </button>
          ))}
        </div>
        <label className="conversation-language">
          {t('Язык разговора', 'Әңгіме тілі')}
          <select
            value={language}
            aria-label={t('Язык разговора', 'Әңгіме тілі')}
            onChange={(e) => {
              speech.stop();
              setLanguage(e.target.value as Locale);
            }}
          >
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
          </select>
        </label>
        <button
          className="new-talk"
          onClick={() => {
            if (state.messages.length || state.draft || state.reply) newTalk.current?.showModal();
            else startNew();
          }}
        >
          <RotateCw size={16} aria-hidden />
          {t('Новый разговор', 'Жаңа әңгіме')}
        </button>
      </div>
      <div className="talk-grid">
        <section className="talk-card my-words" aria-labelledby="my-words-title">
          <div className="talk-card-heading">
            <span className="person-marker">{t('Я', 'Мен')}</span>
            <div>
              <h2 id="my-words-title">{t('Я хочу сказать', 'Менің айтқым келгені')}</h2>
              <p>
                {t(
                  'Напишите или коснитесь готовой фразы.',
                  'Жазыңыз немесе дайын сөйлемді таңдаңыз.',
                )}
              </p>
            </div>
          </div>
          <label htmlFor="my-message" className="sr-only">
            {t('Моё сообщение', 'Менің хабарламам')}
          </label>
          <textarea
            id="my-message"
            value={state.draft}
            maxLength={1000}
            rows={3}
            placeholder={t(
              'Например: когда сдавать работу?',
              'Мысалы: жұмысты қашан тапсыру керек?',
            )}
            onChange={(e) => {
              conversation.setDraft(e.target.value);
              setAssistant(null);
              request.current?.abort();
              ticket.current++;
              setThinking(false);
            }}
          />
          <div className="compose-actions">
            <Button
              variant="primary"
              size="lg"
              disabled={!state.draft.trim()}
              onClick={() => {
                send();
              }}
            >
              <ArrowUp size={19} aria-hidden />
              {t('Показать собеседнику', 'Әңгімелесушіге көрсету')}
            </Button>
            <button
              className="save-phrase"
              disabled={!state.draft.trim() || state.draft.length > 150}
              onClick={favorite}
            >
              <Bookmark size={18} aria-hidden />
              <span>{t('Сохранить фразу', 'Сөйлемді сақтау')}</span>
            </button>
          </div>
          <div className="assist-action">
            <button
              disabled={!state.draft.trim() || thinking}
              onClick={() => {
                if (aiApproved) {
                  void helpPhrase();
                } else aiConsent.current?.showModal();
              }}
            >
              <Sparkles size={16} aria-hidden />
              {thinking
                ? t('Подбираем формулировку…', 'Сөйлем құрастыруда…')
                : t('Помочь сформулировать', 'Сөйлем құрауға көмектесу')}
            </button>
            {thinking ? (
              <button
                onClick={() => {
                  request.current?.abort();
                  ticket.current++;
                  setThinking(false);
                }}
              >
                {t('Отмена', 'Бас тарту')}
              </button>
            ) : null}
          </div>
          {assistant && assistant.source === state.draft ? (
            <div className="phrase-suggestion">
              <p className="field-label">
                {t('Предложение ИИ — проверьте смысл', 'ЖИ ұсынысы — мағынасын тексеріңіз')}
              </p>
              <p>{assistant.text}</p>
              <Button
                onClick={() => {
                  conversation.setDraft(assistant.text);
                  setAssistant(null);
                }}
              >
                {t('Использовать этот вариант', 'Осы нұсқаны қолдану')}
              </Button>
            </div>
          ) : null}
          <div className="phrase-heading">
            <h3>{t('Быстрые фразы', 'Жылдам сөйлемдер')}</h3>
            <div role="group" aria-label={t('Набор фраз', 'Сөйлемдер жиынтығы')}>
              <button
                aria-pressed={phraseTab === 'college'}
                onClick={() => {
                  setPhraseTab('college');
                }}
              >
                {t('Для колледжа', 'Колледж үшін')}
              </button>
              <button
                aria-pressed={phraseTab === 'saved'}
                onClick={() => {
                  setPhraseTab('saved');
                }}
              >
                {t('Мои', 'Менің')}
              </button>
            </div>
          </div>
          <div className="college-phrases">
            {(phraseTab === 'college' ? phrasesFor(state.scene, language) : favorites).map(
              (text) => (
                <div key={text}>
                  <button
                    className="phrase-button"
                    onClick={() => {
                      send(text, 'phrase');
                    }}
                  >
                    {text}
                    <ArrowUp size={16} aria-hidden />
                  </button>
                  {phraseTab === 'saved' ? (
                    <button
                      className="remove-phrase"
                      aria-label={t(`Удалить фразу ${text}`, `${text} сөйлемін жою`)}
                      onClick={() => {
                        const next = favorites.filter((v) => v !== text);
                        try {
                          localStorage.setItem('signtalk.favoritePhrases', JSON.stringify(next));
                          setFavorites(next);
                        } catch {
                          setNotice(t('Не удалось удалить фразу.', 'Сөйлемді жою мүмкін болмады.'));
                        }
                      }}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </div>
          {phraseTab === 'saved' && !favorites.length ? (
            <p className="small-explanation">
              {t(
                'Введите частую фразу и нажмите «Сохранить фразу». Переписка автоматически не сохраняется.',
                'Жиі қолданылатын сөйлемді енгізіп, «Сөйлемді сақтау» батырмасын басыңыз. Әңгіме автоматты түрде сақталмайды.',
              )}
            </p>
          ) : null}
        </section>
        <section
          ref={partnerCard}
          className="talk-card partner-side"
          aria-labelledby="partner-title"
        >
          <div className="talk-card-heading">
            <span className="person-marker partner-marker">
              <MessageSquare size={19} aria-hidden />
            </span>
            <div>
              <h2 id="partner-title">{t('Собеседнику', 'Әңгімелесушіге')}</h2>
              <p>
                {t(
                  'Можно читать, отвечать голосом или писать.',
                  'Оқуға, дауыспен не мәтінмен жауап беруге болады.',
                )}
              </p>
            </div>
          </div>
          <div className="partner-message" aria-live="polite" aria-atomic="true">
            <p lang={lastMine?.language ?? language}>{view}</p>
          </div>
          <div className="partner-message-actions">
            <Button
              disabled={!lastMine}
              onClick={() => {
                if (lastMine) speech.speak(lastMine.text, lastMine.language);
              }}
            >
              <Volume2 size={17} aria-hidden />
              {t('Озвучить', 'Дыбыстау')}
            </Button>
            <Button
              onClick={() => {
                setFlipped(false);
                display.current?.showModal();
              }}
            >
              <Expand size={17} aria-hidden />
              {t('На весь экран', 'Толық экран')}
            </Button>
            <button className="text-button" onClick={speech.stopVoice}>
              {t('Стоп звук', 'Дыбысты тоқтату')}
            </button>
          </div>
          <div className={`reply-heading ${speech.listening ? 'is-listening' : ''}`}>
            <h3>{t('Ответ собеседника', 'Әңгімелесушінің жауабы')}</h3>
            <button
              className="listen-button"
              disabled={!speech.available}
              aria-pressed={speech.listening}
              onClick={listen}
            >
              {speech.listening ? <Square size={17} aria-hidden /> : <Mic size={18} aria-hidden />}
              {speech.listening ? t('Остановить', 'Тоқтату') : t('Слушать ответ', 'Жауапты тыңдау')}
            </button>
          </div>
          <div className="live-reply" data-testid="live-reply">
            <p lang={language}>
              {speech.partial ||
                lastPartner?.text ||
                (speech.listening
                  ? t('Слушаем собеседника…', 'Әңгімелесушіні тыңдауда…')
                  : t(
                      'Здесь появятся слова собеседника.',
                      'Мұнда әңгімелесушінің сөзі пайда болады.',
                    ))}
            </p>
            {speech.partial ? <span>{t('Промежуточный текст', 'Аралық мәтін')}</span> : null}
          </div>
          {!speech.available ? (
            <p className="small-explanation">
              {t(
                'В этом браузере нет распознавания речи. Напишите ответ ниже.',
                'Бұл браузерде сөйлеуді тану жоқ. Жауапты төменде жазыңыз.',
              )}
            </p>
          ) : null}
          <label htmlFor="partner-reply" className="reply-label">
            {t('Или напишите ответ', 'Немесе жауап жазыңыз')}
          </label>
          <div className="reply-input">
            <textarea
              id="partner-reply"
              value={state.reply}
              rows={2}
              maxLength={1000}
              onChange={(e) => {
                conversation.setReply(e.target.value);
              }}
              placeholder={t('Например: до пятницы, в 15:00', 'Мысалы: жұмаға дейін, 15:00-де')}
            />
            <button
              disabled={!state.reply.trim()}
              aria-label={t('Отправить ответ', 'Жауапты жіберу')}
              onClick={() => {
                speech.stop();
                conversation.send('partner', state.reply, language);
                conversation.setReply('');
              }}
            >
              <ArrowUp size={21} aria-hidden />
            </button>
          </div>
          <button
            className="return-to-compose"
            onClick={() => {
              document.getElementById('my-message')?.focus();
            }}
          >
            <ArrowUp size={17} aria-hidden />
            {t('Написать своё сообщение', 'Өз хабарламамды жазу')}
          </button>
        </section>
      </div>
      <p role="status" className="conversation-notice">
        {notice || speech.notice}
      </p>
      {state.messages.length ? (
        <section className="conversation-thread" aria-labelledby="thread-title">
          <div className="thread-heading">
            <h2 id="thread-title">{t('Этот разговор', 'Осы әңгіме')}</h2>
            <span>{t('Только на время открытой страницы', 'Бет ашық тұрған уақытқа ғана')}</span>
          </div>
          <ol>
            {state.messages.map((message) => (
              <li key={message.id} className={`thread-message from-${message.role}`}>
                <span>
                  {message.role === 'me' ? t('Я', 'Мен') : t('Собеседник', 'Әңгімелесуші')}
                  {message.source === 'speech'
                    ? t(' · распознано из речи', ' · сөйлеуден танылды')
                    : ''}
                </span>
                <p lang={message.language}>{message.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <div className="conversation-empty">
          <GraduationCap size={20} aria-hidden />
          <p>
            {t(
              'Уточните задание, договоритесь о встрече, задайте вопрос преподавателю. Разговор доступен сразу — камера не нужна.',
              'Тапсырманы нақтылаңыз, кездесуді келісіңіз, оқытушыға сұрақ қойыңыз. Әңгіме бірден қолжетімді — камера қажет емес.',
            )}
          </p>
        </div>
      )}
      <dialog ref={speechConsent} className="consent-dialog" aria-labelledby="speech-consent-title">
        <h2 id="speech-consent-title">
          {t('Включить субтитры ответа?', 'Жауап субтитрін қосу керек пе?')}
        </h2>
        <p>
          {t(
            'Распознавание речи браузера может передавать звук его провайдеру. Предупредите собеседника. Поддержка русского и казахского зависит от браузера.',
            'Браузердің сөйлеуді тануы дыбысты қызмет провайдеріне жіберуі мүмкін. Әңгімелесушіге ескертіңіз. Орыс және қазақ тілдерін қолдау браузерге байланысты.',
          )}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setSpeechApproved(true);
            speechConsent.current?.close();
            speech.start();
          }}
        >
          {t('Разрешить и слушать', 'Рұқсат беру және тыңдау')}
        </Button>
        <Button
          onClick={() => {
            speechConsent.current?.close();
            document.getElementById('partner-reply')?.focus();
          }}
        >
          {t('Лучше напишу', 'Жазғаным дұрыс')}
        </Button>
      </dialog>
      <dialog ref={aiConsent} className="consent-dialog" aria-labelledby="ai-consent-title">
        <h2 id="ai-consent-title">
          {t('Помочь с этой фразой?', 'Осы сөйлемге көмектесу керек пе?')}
        </h2>
        <p>
          {t(
            'Текст из поля будет отправлен Google. ИИ предложит формулировку, а вы решите, использовать ли её. Не отправляйте личные сведения, если не хотите делиться ими с сервисом.',
            'Өрістегі мәтін Google-ға жіберіледі. ЖИ сөйлем ұсынады, оны қолдануды өзіңіз шешесіз. Қызметпен бөліскіңіз келмесе, жеке мәлімет жібермеңіз.',
          )}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setAiApproved(true);
            aiConsent.current?.close();
            void helpPhrase();
          }}
        >
          {t('Отправить эту фразу', 'Осы сөйлемді жіберу')}
        </Button>
        <Button onClick={() => aiConsent.current?.close()}>{t('Отмена', 'Бас тарту')}</Button>
      </dialog>
      <dialog
        ref={display}
        className={`large-message presentation ${flipped ? 'flipped' : ''}`}
        aria-label={t('Сообщение собеседнику', 'Әңгімелесушіге хабарлама')}
      >
        <div className="presentation-actions">
          <button
            onClick={() => {
              setFlipped(!flipped);
            }}
          >
            <RotateCw size={18} aria-hidden />
            {t('Повернуть', 'Бұру')}
          </button>
          <button onClick={() => display.current?.close()} aria-label={t('Закрыть', 'Жабу')}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <p lang={lastMine?.language ?? language}>{view}</p>
      </dialog>
      <dialog ref={newTalk} className="consent-dialog" aria-labelledby="new-talk-title">
        <h2 id="new-talk-title">{t('Начать новый разговор?', 'Жаңа әңгіме бастау керек пе?')}</h2>
        <p>
          {t(
            'Переписка и черновики этой страницы будут очищены. Ваши сохранённые фразы останутся.',
            'Осы беттің әңгімесі мен нобайлары тазаланады. Сақталған сөйлемдеріңіз қалады.',
          )}
        </p>
        <Button variant="primary" onClick={startNew}>
          <Trash2 size={16} aria-hidden />
          {t('Начать новый разговор', 'Жаңа әңгіме бастау')}
        </Button>
        <Button onClick={() => newTalk.current?.close()}>
          {t('Продолжить этот', 'Осыны жалғастыру')}
        </Button>
      </dialog>
    </div>
  );
}
