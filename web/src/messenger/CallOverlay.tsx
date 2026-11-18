import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  Hand,
  Languages,
  MessageCircle,
  Mic,
  MicOff,
  PanelRight,
  Phone,
  PhoneOff,
  Send,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import { useLocale, type Locale } from '../locale';
import { CaptionSession, recognitionFactory } from '../conversation/captions';
import type { Message, User } from './api';
import { calls, useCall, type CallSnapshot } from './call';
import { messenger, useMessenger } from './store';
import { Avatar } from './ChatsPage';
import { DotField } from '../components/brand/DotField';
import { duration, endText } from './format';
import { library, useGestureLibrary } from '../gestures/library';
import { isReady } from '../ml/prototypes';
import {
  LiveTranslator,
  type TranslatorEvent,
  type TranslatorGuess,
  type TranslatorModel,
} from './translator';

function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs, enabled]);
  return now;
}

function IncomingCall({ peer }: { peer: User }) {
  const { t } = useLocale();
  return (
    <div
      className="call-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-title"
    >
      <div className="incoming-card">
        <div className="ring-pulse">
          <Avatar user={peer} size={88} />
        </div>
        <p className="muted">{t('Входящий видеозвонок', 'Кіріс бейнеқоңырау')}</p>
        <h2 id="incoming-title">{peer.displayName}</h2>
        <p className="muted">{peer.id}</p>
        <div className="incoming-actions">
          <button
            type="button"
            className="round-button decline"
            onClick={() => {
              calls.reject();
            }}
          >
            <PhoneOff size={26} aria-hidden />
            <span>{t('Отклонить', 'Қабылдамау')}</span>
          </button>
          <button
            type="button"
            className="round-button accept"
            onClick={() => void calls.accept()}
            autoFocus
          >
            <Phone size={26} aria-hidden />
            <span>{t('Ответить', 'Жауап беру')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Attaches a MediaStream to a <video> and reports whether autoplay with sound was blocked. */
function useVideo(stream: MediaStream | null, muted: boolean) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    video.muted = muted;
    video.play().then(
      () => {
        setBlocked(false);
      },
      () => {
        setBlocked(true);
      },
    );
  }, [stream, muted]);
  const resume = () => {
    void ref.current?.play().then(() => {
      setBlocked(false);
    });
  };
  return [ref, blocked, resume] as const;
}

function speakText(text: string, language: Locale, rate = 1): SpeechSynthesisUtterance | null {
  if (!('speechSynthesis' in window)) return null;
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.toLowerCase().startsWith(language));
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === 'kk' ? 'kk-KZ' : 'ru-RU';
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function CallScreen({ call, peer }: { call: CallSnapshot; peer: User }) {
  const { lang, t } = useLocale();
  const snap = useMessenger();
  const me = snap.user;
  const chat = snap.chats[peer.id];
  const [selfRef] = useVideo(call.localStream, true);
  const [remoteRef, remoteBlocked, resumeRemote] = useVideo(call.remoteStream, false);
  const live = call.phase === 'active' || call.phase === 'connecting';
  const now = useNow(1000, call.phase !== 'ended');

  // Settings for this call
  const [panel, setPanel] = useState(false);
  const [translateOn, setTranslateOn] = useState(true);
  const [model, setModel] = useState<TranslatorModel>('personal');
  const [language, setLanguage] = useState<Locale>(lang);
  const gestureLib = useGestureLibrary();
  const myGestures = gestureLib.gestures.filter(
    (g) => g.setId === gestureLib.activeSetId && isReady(g),
  );
  const [autoSend, setAutoSend] = useState(true);
  const [speechOn, setSpeechOn] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');

  // Translator state
  const [trState, setTrState] = useState<'off' | 'loading' | 'ready' | 'error'>('off');
  const [hands, setHands] = useState(false);
  const [signing, setSigning] = useState(false);
  const [lastSign, setLastSign] = useState<{
    text: string;
    accepted: boolean;
    guesses: TranslatorGuess[];
    sent: boolean;
  } | null>(null);
  const [spelling, setSpelling] = useState('');
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);

  const hasLocalVideo = !!call.localStream?.getVideoTracks().length;
  const hasRemoteVideo = !!call.remoteStream?.getVideoTracks().length;

  // Messages exchanged during this call (the chat may still be loading when the call starts).
  const [baseline, setBaseline] = useState<number | null>(() => {
    const current = messenger.chat(peer.id);
    return current.loaded ? (current.messages.at(-1)?.id ?? 0) : null;
  });
  useEffect(() => {
    if (baseline !== null) return;
    void messenger
      .loadHistory(peer.id)
      .catch(() => undefined)
      .then(() => {
        setBaseline(messenger.chat(peer.id).messages.at(-1)?.id ?? 0);
      });
  }, [baseline, peer.id]);
  const transcript = useMemo<Message[]>(
    () =>
      baseline === null || !chat
        ? []
        : chat.messages.filter((m) => m.id > baseline && m.kind !== 'call'),
    [chat, baseline],
  );
  const lastPeer = transcript.findLast((m) => m.from === peer.id);
  const lastPeerId = lastPeer?.id;
  useEffect(() => {
    // Messages seen as subtitles during the call count as read.
    if (lastPeerId !== undefined) messenger.markRead(peer.id);
  }, [lastPeerId, peer.id]);
  const remoteCaption = call.remoteCaption;
  const speechSupported = !!recognitionFactory();

  // Send a recognised or typed text to the other person (stored in the chat as well).
  const lastSent = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const sendText = useCallback(
    async (text: string, kind: 'sign' | 'speech' | 'text') => {
      const body = text.trim();
      if (!body) return;
      try {
        await messenger.send(peer.id, body, kind);
      } catch {
        setNotice(
          t(
            'Не удалось отправить. Проверьте связь.',
            'Жіберу мүмкін болмады. Байланысты тексеріңіз.',
          ),
        );
      }
    },
    [peer.id, t, setNotice],
  );

  // --- sign translation on this device ---------------------------------------------------
  const autoSendRef = useRef(autoSend);
  useEffect(() => {
    autoSendRef.current = autoSend;
  }, [autoSend]);
  const translator = useRef<LiveTranslator | null>(null);
  useEffect(() => {
    const video = selfRef.current;
    if (!translateOn || !hasLocalVideo || !live || !video) return;
    const onEvent = (event: TranslatorEvent) => {
      switch (event.type) {
        case 'state':
          setTrState(event.state);
          if (event.state === 'error')
            setNotice(
              t(
                'Не удалось запустить распознавание жестов.',
                'Ым тануды іске қосу мүмкін болмады.',
              ),
            );
          break;
        case 'hands':
          setHands(event.visible);
          break;
        case 'signing':
          setSigning(true);
          if (model !== 'bukva') calls.sendCaption('signing', 'status', false);
          break;
        case 'spelling':
          // The word being spelled goes to the other person as a live caption.
          setSpelling(event.text);
          setSigning(!!event.text);
          calls.sendCaption(event.text, 'sign', false);
          break;
        case 'result': {
          setSigning(false);
          const repeat =
            lastSent.current.text === event.text && Date.now() - lastSent.current.at < 600;
          const send = event.accepted && autoSendRef.current && !!event.text && !repeat;
          setLastSign({
            text: event.text,
            accepted: event.accepted,
            guesses: event.guesses,
            sent: send,
          });
          if (send) {
            lastSent.current = { text: event.text, at: Date.now() };
            void sendText(event.text, 'sign');
          }
          if (!send) calls.sendCaption('', 'status', true);
          if (model === 'bukva') {
            setSpelling('');
            calls.sendCaption('', 'sign', true);
          }
          break;
        }
      }
    };
    const instance = new LiveTranslator(video, model, onEvent);
    translator.current = instance;
    void instance.start();
    return () => {
      instance.stop();
      if (translator.current === instance) translator.current = null;
      setTrState('off');
      setHands(false);
      setSigning(false);
      setSpelling('');
    };
    // selfRef is a stable ref; restarting on it would reload the models.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateOn, hasLocalVideo, live, model, sendText, t]);

  // --- speech → text captions (for a hearing person in the call) ------------------------------
  const speaking = useRef(false);
  const captions = useRef<CaptionSession | null>(null);
  const lastInterim = useRef(0);
  useEffect(() => {
    if (!speechOn || !live) return;
    const Ctor = recognitionFactory();
    if (!Ctor) return;
    let stopped = false;
    let starting = false;
    const begin = () => {
      starting = true;
      session.start(Ctor, language);
      starting = false;
    };
    const session: CaptionSession = new CaptionSession({
      final: (text) => {
        if (!speaking.current) void sendText(text, 'speech');
      },
      interim: (text) => {
        setPartial(text);
        if (speaking.current || !text) return;
        const at = Date.now();
        if (at - lastInterim.current > 350) {
          lastInterim.current = at;
          calls.sendCaption(text, 'speech', false);
        }
      },
      state: (on) => {
        setListening(on);
        // Browsers end recognition after silence; keep listening while enabled.
        if (!on && !stopped && !starting)
          window.setTimeout(() => {
            if (!stopped && captions.current === session) begin();
          }, 400);
      },
      error: (code) => {
        if (code === 'no-speech' || code === 'aborted') return;
        stopped = true;
        setSpeechOn(false);
        setNotice(
          code === 'not-allowed' || code === 'service-not-allowed'
            ? t('Нет доступа к микрофону для субтитров.', 'Субтитр үшін микрофонға рұқсат жоқ.')
            : t(
                'Распознавание речи недоступно (нужен интернет и Chrome/Edge).',
                'Сөйлеуді тану қолжетімсіз (интернет және Chrome/Edge қажет).',
              ),
        );
      },
    });
    captions.current = session;
    begin();
    return () => {
      stopped = true;
      captions.current = null;
      session.stop();
      setPartial('');
    };
  }, [speechOn, live, language, sendText, t]);

  // --- read the other person's messages aloud -------------------------------------------------
  const spoken = useRef<number>(0);
  useEffect(() => {
    if (!lastPeer || lastPeer.id <= spoken.current) return;
    spoken.current = lastPeer.id;
    if (!ttsOn) return;
    if (lastPeer.kind === 'speech') return; // the hearing person already heard it
    const utterance = speakText(lastPeer.body, language);
    if (utterance) {
      speaking.current = true;
      utterance.onend = utterance.onerror = () => {
        speaking.current = false;
      };
    }
  }, [lastPeer, ttsOn, language]);
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  // Escape closes the side panel on phones.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const statusLine = call.mediaPending
    ? t(
        'Разрешите доступ к камере и микрофону в окне браузера…',
        'Браузер терезесінде камера мен микрофонға рұқсат беріңіз…',
      )
    : call.phase === 'outgoing'
      ? t('Вызов…', 'Шақыру…')
      : call.phase === 'connecting'
        ? t('Соединение…', 'Қосылуда…')
        : call.phase === 'active'
          ? duration((now - (call.startedAt ?? now)) / 1000)
          : endText(call.endStatus, call.endReason, t);

  // Uses the local arrival time: the server clock may differ from this device's.
  const arrived = lastPeer ? messenger.arrivedAt(lastPeer.id) : undefined;
  const showPeerSubtitle = !!lastPeer && arrived !== undefined && now - arrived < 9000;
  const showRemoteStatus = remoteCaption && now - remoteCaption.at < 4000;

  return (
    <div
      className={`call-screen ${panel ? 'panel-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t(`Видеозвонок: ${peer.displayName}`, `Бейнеқоңырау: ${peer.displayName}`)}
    >
      <div className="call-stage">
        <DotField alpha={0.06} />
        <video
          ref={remoteRef}
          className={`remote-video ${hasRemoteVideo ? '' : 'hidden'}`}
          playsInline
          autoPlay
        />
        {!hasRemoteVideo || call.phase !== 'active' ? (
          <div className="remote-placeholder">
            <div className={call.phase === 'outgoing' ? 'ring-pulse' : ''}>
              <Avatar user={peer} size={104} />
            </div>
            <h2>{peer.displayName}</h2>
            <p>{statusLine}</p>
            {call.mediaPending ? (
              <button
                type="button"
                className="pill-button light"
                onClick={() => {
                  calls.continueWithoutMedia();
                }}
              >
                {t('Продолжить без камеры', 'Камерасыз жалғастыру')}
              </button>
            ) : null}
            {call.phase === 'ended' ? (
              <button
                type="button"
                className="pill-button light"
                onClick={() => {
                  calls.dismiss();
                }}
              >
                {t('Закрыть', 'Жабу')}
              </button>
            ) : null}
          </div>
        ) : null}
        {call.phase === 'active' && hasRemoteVideo ? (
          <div className="call-top">
            <b>{peer.displayName}</b>
            <span>{statusLine}</span>
          </div>
        ) : null}
        {remoteBlocked && call.remoteStream ? (
          <button type="button" className="pill-button light unmute" onClick={resumeRemote}>
            <Volume2 size={16} aria-hidden /> {t('Включить звук', 'Дыбысты қосу')}
          </button>
        ) : null}

        <div className="subtitles" aria-live="polite">
          {showRemoteStatus &&
          remoteCaption.source === 'status' &&
          remoteCaption.text === 'signing' &&
          !remoteCaption.final ? (
            <p className="subtitle status">
              <Hand size={16} aria-hidden />{' '}
              {t('Собеседник показывает жест…', 'Әңгімелесуші ым көрсетіп жатыр…')}
            </p>
          ) : null}
          {showRemoteStatus && remoteCaption.source === 'speech' && remoteCaption.text ? (
            <p className="subtitle interim">{remoteCaption.text}</p>
          ) : showRemoteStatus &&
            remoteCaption.source === 'sign' &&
            !remoteCaption.final &&
            remoteCaption.text ? (
            <p className="subtitle interim spelling">
              <Hand size={18} aria-hidden /> {remoteCaption.text}
              <span className="spelling-caret" aria-hidden />
            </p>
          ) : showPeerSubtitle ? (
            <p className={`subtitle kind-${lastPeer.kind}`} key={lastPeer.id}>
              {lastPeer.kind === 'sign' ? (
                <Hand size={18} aria-hidden />
              ) : lastPeer.kind === 'speech' ? (
                <Mic size={18} aria-hidden />
              ) : (
                <MessageCircle size={18} aria-hidden />
              )}
              {lastPeer.body}
            </p>
          ) : null}
        </div>

        {call.phase !== 'ended' ? (
          <div className="self-view">
            <video
              ref={selfRef}
              muted
              playsInline
              autoPlay
              className={hasLocalVideo && call.camOn ? '' : 'hidden'}
            />
            {!hasLocalVideo || !call.camOn ? (
              <span className="self-off">
                <VideoOff size={22} aria-hidden />
              </span>
            ) : null}
            {translateOn && hasLocalVideo ? (
              <span className={`hands-chip ${signing ? 'signing' : hands ? 'on' : ''}`}>
                <Hand size={13} aria-hidden />
                {trState === 'loading'
                  ? t('загрузка модели…', 'модель жүктелуде…')
                  : trState === 'error'
                    ? t('ошибка', 'қате')
                    : model === 'bukva'
                      ? hands
                        ? t('вижу букву', 'әріпті көремін')
                        : spelling
                          ? t('пауза — слово уйдёт', 'кідіріс — сөз жіберіледі')
                          : t('покажите букву', 'әріпті көрсетіңіз')
                      : signing
                        ? t('читаю жест…', 'ымды оқудамын…')
                        : hands
                          ? t('руки видны', 'қол көрінеді')
                          : t('покажите руки', 'қолды көрсетіңіз')}
              </span>
            ) : null}
            {spelling && translateOn ? (
              <span className="self-result spelling">{spelling}</span>
            ) : lastSign && translateOn ? (
              <span className={`self-result ${lastSign.accepted ? '' : 'unsure'}`}>
                {lastSign.accepted ? lastSign.text : t('не уверено', 'сенімсіз')}
              </span>
            ) : null}
          </div>
        ) : null}

        {call.phase !== 'ended' ? (
          <div
            className="call-controls"
            role="toolbar"
            aria-label={t('Управление звонком', 'Қоңырауды басқару')}
          >
            <button
              type="button"
              className={`control ${call.micOn ? '' : 'off'}`}
              onClick={() => {
                calls.toggleMic();
              }}
              aria-pressed={!call.micOn}
              disabled={!call.localStream?.getAudioTracks().length}
              aria-label={
                call.micOn
                  ? t('Выключить микрофон', 'Микрофонды өшіру')
                  : t('Включить микрофон', 'Микрофонды қосу')
              }
            >
              {call.micOn ? <Mic size={22} aria-hidden /> : <MicOff size={22} aria-hidden />}
            </button>
            <button
              type="button"
              className={`control ${call.camOn ? '' : 'off'}`}
              onClick={() => {
                calls.toggleCam();
              }}
              aria-pressed={!call.camOn}
              disabled={!hasLocalVideo}
              aria-label={
                call.camOn
                  ? t('Выключить камеру', 'Камераны өшіру')
                  : t('Включить камеру', 'Камераны қосу')
              }
            >
              {call.camOn ? <Video size={22} aria-hidden /> : <VideoOff size={22} aria-hidden />}
            </button>
            <button
              type="button"
              className={`control ${translateOn ? 'active' : ''}`}
              onClick={() => {
                setTranslateOn(!translateOn);
              }}
              aria-pressed={translateOn}
              disabled={!hasLocalVideo}
              aria-label={t('Перевод жестов', 'Ым аудармасы')}
              title={t('Перевод жестов', 'Ым аудармасы')}
            >
              <Hand size={22} aria-hidden />
            </button>
            <button
              type="button"
              className={`control ${speechOn ? 'active' : ''}`}
              onClick={() => {
                setSpeechOn(!speechOn);
              }}
              aria-pressed={speechOn}
              disabled={!speechSupported}
              aria-label={t('Субтитры моей речи', 'Сөйлеуімнің субтитрі')}
              title={t('Субтитры моей речи', 'Сөйлеуімнің субтитрі')}
            >
              <Captions size={22} aria-hidden />
            </button>
            <button
              type="button"
              className={`control panel-toggle ${panel ? 'active' : ''}`}
              onClick={() => {
                setPanel(!panel);
              }}
              aria-pressed={panel}
              aria-label={t('Панель перевода и чата', 'Аударма және чат панелі')}
            >
              <PanelRight size={22} aria-hidden />
            </button>
            <button
              type="button"
              className="control hangup"
              onClick={() => {
                calls.hangUp();
              }}
              aria-label={t('Завершить звонок', 'Қоңырауды аяқтау')}
            >
              <span className="hangup-label">{t('Завершить', 'Аяқтау')}</span>
              <PhoneOff size={24} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <aside
        className="call-panel"
        aria-label={t('Перевод и переписка', 'Аударма және хат алмасу')}
      >
        <div className="call-panel-head">
          <b>{t('Перевод и чат', 'Аударма және чат')}</b>
          <button
            type="button"
            className="icon-button panel-close"
            onClick={() => {
              setPanel(false);
            }}
            aria-label={t('Закрыть панель', 'Панельді жабу')}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <section className="panel-section">
          <h3>
            <span className="panel-index" aria-hidden>
              01
            </span>
            <Hand size={16} aria-hidden /> {t('Жесты → текст', 'Ым → мәтін')}
          </h3>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={translateOn}
              disabled={!hasLocalVideo}
              onChange={(e) => {
                setTranslateOn(e.target.checked);
              }}
            />
            <span>{t('Переводить мои жесты', 'Ымдарымды аудару')}</span>
          </label>
          <div className="panel-fields">
            <label>
              <span>{t('Что распознавать', 'Нені тану')}</span>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value as TranslatorModel);
                }}
              >
                <option value="personal">{t('Мои жесты', 'Менің ымдарым')}</option>
                <option value="bukva">
                  {t('Русский алфавит (33 буквы)', 'Орыс әліпбиі (33 әріп)')}
                </option>
              </select>
            </label>
            {model === 'personal' && gestureLib.sets.length ? (
              <label>
                <span>{t('Набор жестов', 'Ым жинағы')}</span>
                <select
                  value={gestureLib.activeSetId ?? ''}
                  onChange={(e) => {
                    library.setActiveSet(e.target.value);
                  }}
                >
                  {gestureLib.sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name} (
                      {gestureLib.gestures.filter((g) => g.setId === set.id && isReady(g)).length})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>
                <Languages size={13} aria-hidden /> {t('Язык речи', 'Сөйлеу тілі')}
              </span>
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value as Locale);
                }}
              >
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
              </select>
            </label>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => {
                setAutoSend(e.target.checked);
              }}
            />
            <span>
              {t('Сразу отправлять уверенный результат', 'Сенімді нәтижені бірден жіберу')}
            </span>
          </label>
          {model === 'bukva' && translateOn ? (
            <div className="sign-result spelling-box">
              <p>
                <small>{t('Слово по буквам', 'Әріппен сөз')}</small>
                <b className="spelling-word">{spelling || '…'}</b>
              </p>
              <div className="guess-chips">
                <button
                  type="button"
                  disabled={!spelling}
                  onClick={() => {
                    translator.current?.flushWord();
                  }}
                >
                  {t('Отправить сейчас', 'Қазір жіберу')}
                </button>
                <button
                  type="button"
                  disabled={!spelling}
                  onClick={() => {
                    translator.current?.editWord('backspace');
                  }}
                >
                  {t('Стереть букву', 'Әріпті өшіру')}
                </button>
                <button
                  type="button"
                  disabled={!spelling}
                  onClick={() => {
                    translator.current?.editWord('clear');
                  }}
                >
                  {t('Очистить', 'Тазалау')}
                </button>
              </div>
            </div>
          ) : null}
          {lastSign ? (
            <div className="sign-result">
              <p>
                {lastSign.accepted ? (
                  <>
                    <b>{lastSign.text}</b>
                    {lastSign.sent ? <small> · {t('отправлено', 'жіберілді')}</small> : null}
                  </>
                ) : (
                  t(
                    'Жест не распознан уверенно. Выберите вариант или повторите:',
                    'Ым сенімді танылмады. Нұсқаны таңдаңыз немесе қайталаңыз:',
                  )
                )}
              </p>
              <div className="guess-chips">
                {(model === 'bukva' && lastSign.sent ? [] : lastSign.guesses).map((g) => (
                  <button
                    key={g.text}
                    type="button"
                    onClick={() => {
                      void sendText(g.text, 'sign');
                      setLastSign({ ...lastSign, sent: true, text: g.text, accepted: true });
                    }}
                  >
                    {g.text}{' '}
                    {model === 'bukva' ? null : <small>{Math.round(g.probability * 100)}%</small>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted small">
              {model === 'bukva'
                ? t(
                    'Показывайте слово по буквам, каждую около секунды. Опустите руку на 2 секунды — слово уйдёт собеседнику. Буквы видны ему сразу, пока вы показываете. Казахские Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І модель не знает.',
                    'Сөзді әріппен көрсетіңіз, әрқайсысын шамамен бір секунд. Қолды 2 секундқа түсірсеңіз — сөз әңгімелесушіге барады. Әріптерді ол бірден көреді. Қазақтың Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І әріптерін модель білмейді.',
                  )
                : myGestures.length
                  ? t(
                      `Покажите один свой жест, затем опустите руки — его значение уйдёт собеседнику. Ваши жесты: ${myGestures.map((g) => g.name).join(', ')}.`,
                      `Өз ымыңызды көрсетіп, қолды түсіріңіз — мағынасы әңгімелесушіге барады. Ымдарыңыз: ${myGestures.map((g) => g.name).join(', ')}.`,
                    )
                  : t(
                      'В выбранном наборе пока нет готовых жестов. Добавьте их в разделе «Мои жесты» — они сразу появятся здесь.',
                      'Таңдалған жинақта әзір дайын ым жоқ. Оларды «Менің ымдарым» бөлімінде қосыңыз — олар осында бірден пайда болады.',
                    )}
            </p>
          )}
          <p className="muted small">
            {t(
              'Распознавание экспериментальное и работает только на вашем устройстве; видео не отправляется на сервер.',
              'Тану тәжірибелік және тек құрылғыңызда жұмыс істейді; бейне серверге жіберілмейді.',
            )}
          </p>
        </section>

        <section className="panel-section">
          <h3>
            <span className="panel-index" aria-hidden>
              02
            </span>
            <Captions size={16} aria-hidden /> {t('Речь и озвучивание', 'Сөйлеу және дыбыстау')}
          </h3>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={speechOn}
              disabled={!speechSupported}
              onChange={(e) => {
                setSpeechOn(e.target.checked);
              }}
            />
            <span>
              {t('Субтитры моей речи для собеседника', 'Сөйлеуімді әңгімелесушіге субтитр ету')}
            </span>
          </label>
          {!speechSupported ? (
            <p className="muted small">
              {t(
                'Этот браузер не распознаёт речь — используйте Chrome или Edge.',
                'Бұл браузер сөйлеуді танымайды — Chrome немесе Edge қолданыңыз.',
              )}
            </p>
          ) : null}
          {speechOn ? (
            <p className="muted small" role="status">
              {listening
                ? partial
                  ? `… ${partial}`
                  : t('Слушаю…', 'Тыңдап тұрмын…')
                : t('Запуск…', 'Іске қосылуда…')}
            </p>
          ) : null}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={ttsOn}
              onChange={(e) => {
                setTtsOn(e.target.checked);
              }}
            />
            <span>
              <Volume2 size={14} aria-hidden />{' '}
              {t(
                'Озвучивать жесты и сообщения собеседника',
                'Әңгімелесушінің ымдары мен хабарламаларын дыбыстау',
              )}
            </span>
          </label>
        </section>

        <section className="panel-section transcript-section">
          <h3>
            <span className="panel-index" aria-hidden>
              03
            </span>
            <MessageCircle size={16} aria-hidden />{' '}
            {t('Сообщения в звонке', 'Қоңыраудағы хабарламалар')}
          </h3>
          <ol className="transcript" aria-live="polite">
            {transcript.slice(-30).map((m) => (
              <li key={m.id} className={m.from === me?.id ? 'mine' : ''}>
                {m.kind === 'sign' ? (
                  <Hand size={13} aria-label={t('жест', 'ым')} />
                ) : m.kind === 'speech' ? (
                  <Mic size={13} aria-label={t('речь', 'сөйлеу')} />
                ) : null}
                <span>{m.body}</span>
              </li>
            ))}
          </ol>
          <form
            className="transcript-input"
            onSubmit={(e) => {
              e.preventDefault();
              void sendText(draft, 'text');
              setDraft('');
            }}
          >
            <input
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              placeholder={t('Написать…', 'Жазу…')}
              aria-label={t('Сообщение собеседнику', 'Әңгімелесушіге хабарлама')}
            />
            <button type="submit" disabled={!draft.trim()} aria-label={t('Отправить', 'Жіберу')}>
              <Send size={17} aria-hidden />
            </button>
          </form>
        </section>
        {notice ? (
          <p className="call-notice" role="alert">
            {notice}
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setNotice('');
              }}
              aria-label={t('Скрыть', 'Жасыру')}
            >
              <X size={14} aria-hidden />
            </button>
          </p>
        ) : null}
        {call.mediaNote ? (
          <p className="call-notice">
            {call.mediaNote === 'no-camera'
              ? t(
                  'Камера недоступна — собеседник вас не видит.',
                  'Камера қолжетімсіз — әңгімелесуші сізді көрмейді.',
                )
              : call.mediaNote === 'no-microphone'
                ? t(
                    'Микрофон недоступен — звонок без звука с вашей стороны.',
                    'Микрофон қолжетімсіз — сіз жақтан дыбыс жоқ.',
                  )
                : t(
                    'Нет доступа к камере и микрофону. Разрешите доступ в настройках браузера.',
                    'Камера мен микрофонға рұқсат жоқ. Браузер баптауларында рұқсат беріңіз.',
                  )}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

export default function CallOverlay() {
  const call = useCall();
  if (call.phase === 'idle' || !call.peer) return null;
  if (call.phase === 'incoming') return <IncomingCall peer={call.peer} />;
  return <CallScreen call={call} peer={call.peer} />;
}
