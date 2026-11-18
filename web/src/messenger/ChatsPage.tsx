import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  Copy,
  Mic,
  MessageCircle,
  PhoneIncoming,
  PhoneMissed,
  Search,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { useLocale } from '../locale';
import { LandmarkHand } from '../components/LandmarkHand';
import { LiveHand } from '../components/brand/LiveHand';
import { DotField } from '../components/brand/DotField';
import { errorText, type Contact, type Message, type User } from './api';
import { messenger, useMessenger } from './store';
import { calls, useCall } from './call';
import {
  callText,
  clock,
  dayLabel,
  hue,
  initials,
  parseCallBody,
  preview,
  shortDate,
} from './format';

/** A curated set of tones that hold white initials in both themes. */
const AVATAR_TONES = ['#2f6b5a', '#b4532a', '#3d55c4', '#7a4e9e', '#8c6a16', '#2f6f86', '#9c3d54'];

export function Avatar({
  user,
  size = 44,
  online,
}: {
  user: User;
  size?: number;
  online?: boolean;
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: AVATAR_TONES[hue(user.id) % AVATAR_TONES.length],
      }}
      aria-hidden
    >
      {initials(user.displayName)}
      {online !== undefined ? <span className={`presence-dot ${online ? 'on' : ''}`} /> : null}
    </span>
  );
}

export function CopyId({ id, compact = false }: { id: string; compact?: boolean }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-id ${compact ? 'compact' : ''}`}
      onClick={() => {
        try {
          void navigator.clipboard
            .writeText(id)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 1500);
            })
            .catch(() => undefined);
        } catch {
          /* no clipboard on insecure pages; the ID stays visible */
        }
      }}
      aria-label={t(`Скопировать ID ${id}`, `${id} ID көшіру`)}
    >
      <b>{id}</b>
      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
    </button>
  );
}

function AddContact({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ user: User; self: boolean; contact: boolean } | null>(null);
  const search = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    setFound(null);
    try {
      setFound(await messenger.lookup(query));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!found) return;
    setBusy(true);
    try {
      if (!found.contact) await messenger.addContact(found.user.id);
      onOpen(found.user.id);
      setFound(null);
      setQuery('');
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="add-contact">
      <form onSubmit={(e) => void search(e)} role="search">
        <Search size={17} aria-hidden />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError('');
          }}
          placeholder={t('Найти по ID: ST-XXXXXX', 'ID бойынша табу: ST-XXXXXX')}
          aria-label={t(
            'ID или имя пользователя собеседника',
            'Әңгімелесушінің ID немесе пайдаланушы аты',
          )}
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !query.trim()}>
          {t('Найти', 'Табу')}
        </button>
      </form>
      {error ? (
        <p className="add-error" role="alert">
          {error}
        </p>
      ) : null}
      {found ? (
        <div className="found-card" role="status">
          <Avatar user={found.user} size={40} />
          <div>
            <b>{found.user.displayName}</b>
            <small>
              @{found.user.username} · {found.user.id}
            </small>
          </div>
          {found.self ? (
            <small>{t('Это вы', 'Бұл сіз')}</small>
          ) : (
            <button
              type="button"
              className="pill-button"
              onClick={() => void add()}
              disabled={busy}
            >
              {found.contact ? (
                <MessageCircle size={16} aria-hidden />
              ) : (
                <UserPlus size={16} aria-hidden />
              )}
              {found.contact ? t('Открыть', 'Ашу') : t('Добавить', 'Қосу')}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setFound(null);
            }}
            aria-label={t('Закрыть', 'Жабу')}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContactRow({
  contact,
  active,
  me,
}: {
  contact: Contact;
  active: boolean;
  me: string | undefined;
}) {
  const { lang, t } = useLocale();
  const { typing } = useMessenger();
  const isTyping = !!typing[contact.user.id];
  return (
    <li>
      <button
        type="button"
        className={`contact-row ${active ? 'active' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          messenger.openChat(contact.user.id);
        }}
      >
        <Avatar user={contact.user} online={contact.online} />
        <span className="contact-text">
          <span className="contact-top">
            <b>{contact.user.displayName}</b>
            {contact.lastMessage ? (
              <time>{shortDate(contact.lastMessage.createdAt, lang)}</time>
            ) : null}
          </span>
          <span className="contact-bottom">
            <span className={isTyping ? 'typing' : ''}>
              {isTyping
                ? t('печатает…', 'жазып жатыр…')
                : contact.lastMessage
                  ? preview(contact.lastMessage, me, t)
                  : contact.user.id}
            </span>
            {contact.unread ? <span className="unread">{contact.unread}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function Bubble({ message, me }: { message: Message; me: string | undefined }) {
  const { lang, t } = useLocale();
  const mine = message.from === me;
  if (message.kind === 'call') {
    const { status } = parseCallBody(message.body);
    const missed = status !== 'completed';
    return (
      <li className={`call-log ${missed ? 'missed' : ''}`}>
        {missed ? <PhoneMissed size={15} aria-hidden /> : <PhoneIncoming size={15} aria-hidden />}
        <span>{callText(message, me, t)}</span>
        <time>{clock(message.createdAt, lang)}</time>
      </li>
    );
  }
  return (
    <li className={`bubble-row ${mine ? 'mine' : ''}`}>
      <div className={`bubble kind-${message.kind}`}>
        {message.kind === 'sign' ? (
          <span className="bubble-kind">
            <LandmarkHand size={14} /> {t('Перевод жеста', 'Ым аудармасы')}
          </span>
        ) : message.kind === 'speech' ? (
          <span className="bubble-kind">
            <Mic size={13} aria-hidden /> {t('Речь → текст', 'Сөйлеу → мәтін')}
          </span>
        ) : null}
        <p>{message.body}</p>
        <span className="bubble-meta">
          <time>{clock(message.createdAt, lang)}</time>
          {mine ? (
            message.readAt ? (
              <CheckCheck size={14} aria-label={t('Прочитано', 'Оқылды')} />
            ) : (
              <Check size={14} aria-label={t('Доставлено', 'Жеткізілді')} />
            )
          ) : null}
        </span>
      </div>
    </li>
  );
}

const QUICK_PHRASES: [string, string][] = [
  ['Здравствуйте!', 'Сәлеметсіз бе!'],
  ['Спасибо', 'Рахмет'],
  ['Да', 'Иә'],
  ['Нет', 'Жоқ'],
  ['Повторите, пожалуйста', 'Қайталаңызшы'],
  ['Можно позвонить по видео?', 'Бейнеқоңырау шалуға бола ма?'],
];

function Thread({ contact, me }: { contact: Contact; me: User }) {
  const { lang, t } = useLocale();
  const snap = useMessenger();
  const call = useCall();
  const chat = snap.chats[contact.user.id];
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const messages = useMemo(() => chat?.messages ?? [], [chat]);
  const isTyping = !!snap.typing[contact.user.id];
  const rows = useMemo(
    () =>
      messages.map((m, i) => {
        const day = dayLabel(m.createdAt, lang, t);
        const prev = messages[i - 1];
        return { m, day, newDay: !prev || dayLabel(prev.createdAt, lang, t) !== day };
      }),
    [messages, lang, t],
  );

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, contact.user.id]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      stick.current = true;
      await messenger.send(contact.user.id, body);
      setDraft('');
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="chat-thread"
      aria-label={t(`Чат с ${contact.user.displayName}`, `${contact.user.displayName} чаты`)}
    >
      <DotField />
      <header className="thread-header">
        <button
          type="button"
          className="icon-button back-button"
          onClick={() => {
            messenger.openChat(null);
          }}
          aria-label={t('Назад к чатам', 'Чаттарға оралу')}
        >
          <ArrowLeft size={20} aria-hidden />
        </button>
        <Avatar user={contact.user} online={contact.online} />
        <div className="thread-title">
          <b>{contact.user.displayName}</b>
          <small>
            {isTyping
              ? t('печатает…', 'жазып жатыр…')
              : contact.online
                ? t('в сети', 'желіде')
                : t('не в сети', 'желіде емес')}{' '}
            · {contact.user.id}
          </small>
        </div>
        <button
          type="button"
          className="call-button"
          disabled={calls.busy || call.phase === 'outgoing'}
          onClick={() => void calls.start(contact.user)}
          title={contact.online ? undefined : t('Собеседник не в сети', 'Әңгімелесуші желіде емес')}
        >
          <Video size={19} aria-hidden />
          <span>{t('Видеозвонок', 'Бейнеқоңырау')}</span>
        </button>
      </header>
      <div
        className="thread-messages"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 40 && chat?.hasMore && !chat.loading) {
            const before = el.scrollHeight;
            void messenger.loadHistory(contact.user.id, true).then(() => {
              requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - before;
              });
            });
          }
        }}
      >
        {!chat?.loaded ? (
          <p className="thread-empty" role="status">
            {t('Загрузка…', 'Жүктелуде…')}
          </p>
        ) : !messages.length ? (
          <div className="thread-empty">
            <span className="thread-art small">
              <LiveHand />
            </span>
            <p>
              {t(
                'Напишите первое сообщение или начните видеозвонок с переводом жестов.',
                'Алғашқы хабарламаны жазыңыз немесе ым аудармасы бар бейнеқоңырауды бастаңыз.',
              )}
            </p>
          </div>
        ) : (
          <ol className="message-list" aria-live="polite" aria-relevant="additions">
            {rows.map(({ m, day, newDay }) => [
              newDay ? (
                <li className="day-separator" key={`d-${m.id}`}>
                  {day}
                </li>
              ) : null,
              <Bubble key={m.id} message={m} me={me.id} />,
            ])}
          </ol>
        )}
      </div>
      <div className="composer">
        <div className="quick-phrases" aria-label={t('Быстрые фразы', 'Жылдам сөздер')}>
          {QUICK_PHRASES.map(([ru, kk]) => (
            <button key={ru} type="button" onClick={() => void send(lang === 'kk' ? kk : ru)}>
              {lang === 'kk' ? kk : ru}
            </button>
          ))}
        </div>
        {error ? (
          <p className="add-error" role="alert">
            {error}
          </p>
        ) : null}
        <form
          className="composer-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            rows={1}
            maxLength={2000}
            placeholder={t('Сообщение…', 'Хабарлама…')}
            aria-label={t('Текст сообщения', 'Хабарлама мәтіні')}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) messenger.sendTyping(contact.user.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!draft.trim() || sending}
            aria-label={t('Отправить', 'Жіберу')}
          >
            <ArrowUp size={20} aria-hidden />
          </button>
        </form>
      </div>
    </section>
  );
}

export default function ChatsPage() {
  const { t } = useLocale();
  const snap = useMessenger();
  const me = snap.user;
  const active = snap.activeChat
    ? snap.contacts.find((c) => c.user.id === snap.activeChat)
    : undefined;
  useEffect(() => {
    if (snap.activeChat && snap.contactsLoaded && !active) messenger.openChat(null);
  }, [snap.activeChat, snap.contactsLoaded, active]);
  if (!me) return null;
  return (
    <div className={`messenger ${active ? 'has-active' : ''}`}>
      <aside className="chat-sidebar" aria-label={t('Контакты', 'Контактілер')}>
        <div className="my-id-card">
          <div className="my-id-top">
            <div>
              <small>{t('Ваш ID — поделитесь им', 'Сіздің ID — оны бөлісіңіз')}</small>
              <CopyId id={me.id} />
            </div>
            <span className="my-id-mark">
              <LiveHand />
            </span>
          </div>
          <div className="my-id-bottom">
            <span className={`conn-state ${snap.connection}`} role="status">
              {snap.connection === 'online'
                ? t('онлайн', 'онлайн')
                : snap.connection === 'connecting'
                  ? t('подключение…', 'қосылуда…')
                  : t('нет связи', 'байланыс жоқ')}
            </span>
            <span className="my-id-handle">@{me.username}</span>
          </div>
        </div>
        <AddContact
          onOpen={(id) => {
            messenger.openChat(id);
          }}
        />
        {snap.contactsLoaded && !snap.contacts.length ? (
          <div className="contacts-empty">
            <UserPlus size={30} aria-hidden />
            <p>
              {t(
                'Пока нет контактов. Попросите собеседника назвать свой ID и найдите его выше.',
                'Әзірге контакт жоқ. Әңгімелесушіден ID сұрап, жоғарыдан іздеңіз.',
              )}
            </p>
          </div>
        ) : (
          <>
            {snap.contacts.length ? (
              <p className="list-label">
                <span>{t('Контакты', 'Контактілер')}</span>
                <span>{String(snap.contacts.length).padStart(2, '0')}</span>
              </p>
            ) : null}
            <ul className="contact-list">
              {snap.contacts.map((c) => (
                <ContactRow
                  key={c.user.id}
                  contact={c}
                  active={c.user.id === snap.activeChat}
                  me={me.id}
                />
              ))}
            </ul>
          </>
        )}
      </aside>
      {active ? (
        <Thread key={active.user.id} contact={active} me={me} />
      ) : (
        <section className="chat-thread placeholder">
          <DotField />
          <div className="thread-empty">
            <span className="thread-art">
              <LiveHand mode="track" tag="HAND · 21 PTS" />
            </span>
            <h2>{t('Выберите чат', 'Чатты таңдаңыз')}</h2>
            <p>
              {t(
                'Переписывайтесь текстом, а когда удобно — переходите на видеозвонок. Во время звонка жесты переводятся в текст и приходят собеседнику субтитрами.',
                'Мәтінмен хат алмасыңыз, ыңғайлы кезде бейнеқоңырауға өтіңіз. Қоңырау кезінде ымдар мәтінге аударылып, әңгімелесушіге субтитр болып барады.',
              )}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
