import { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, Camera, CircleHelp, Settings2, Eye, Globe2, MessageCircle } from 'lucide-react';
import { LiveHand } from './components/brand/LiveHand';
import { initials } from './messenger/format';
import type { Session } from './app/session';
import { setLocale, useLocale, type Locale } from './locale';
import { MODEL_OPTIONS } from './cloud/client';
import { conversation } from './conversation/session';
import { BuildNotice } from './app/BuildNotice';
import { version } from '../package.json';
import krslLabels from '../public/models/krsl/labels.json';
import { useMessenger } from './messenger/store';
import { calls } from './messenger/call';
const AuthPage = lazy(() => import('./messenger/AuthPage'));
const ChatsPage = lazy(() => import('./messenger/ChatsPage'));
const ProfilePage = lazy(() => import('./messenger/ProfilePage'));
const CallOverlay = lazy(() => import('./messenger/CallOverlay'));
const ConversationPage = lazy(() => import('./conversation/ConversationPage'));
const RecognitionPage = lazy(() => import('./pages/RecognitionPage'));
const DatasetPanel = lazy(() =>
  import('./components/DatasetPanel').then((m) => ({ default: m.DatasetPanel })),
);
const HelpPage = lazy(() => import('./pages/HelpPage'));
const GesturePage = lazy(() => import('./pages/GesturePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NativePanel = lazy(() =>
  import('./components/NativePanel').then((m) => ({ default: m.NativePanel })),
);
type Page =
  'chats' | 'profile' | 'talk' | 'recognition' | 'gestures' | 'dataset' | 'help' | 'settings';
const PAGES: readonly Page[] = [
  'chats',
  'profile',
  'talk',
  'recognition',
  'gestures',
  'dataset',
  'help',
  'settings',
];
function currentPage(): Page {
  const hash = location.hash.slice(1);
  return (PAGES as readonly string[]).includes(hash) ? (hash as Page) : 'chats';
}
function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function App({ session }: { session: Session }) {
  const { lang, t } = useLocale();
  const account = useMessenger();
  const unread = account.contacts.reduce((sum, c) => sum + c.unread, 0);
  const [page, setPage] = useState<Page>(currentPage);
  const [language, setLanguage] = useState<Locale>(lang);
  const changeLanguage = (value: Locale) => {
    const draft = conversation.getSnapshot().draft;
    const label = krslLabels.find((item) => item.ru === draft || item.kk === draft);
    if (label) conversation.setDraft(label[value]);
    setLanguage(value);
  };
  const [model, setModel] = useState(() => {
    const value = stored('signtalk.cloudModel', 'gemini-3.5-flash-lite');
    return MODEL_OPTIONS.includes(value) ? value : 'gemini-3.5-flash-lite';
  });
  const [large, setLarge] = useState(() => stored('signtalk.large', 'false') === 'true');
  const [contrast, setContrast] = useState(() => stored('signtalk.contrast', 'false') === 'true');
  useEffect(() => {
    const change = () => {
      if (location.hash === '#main-content') return;
      setPage(currentPage());
    };
    window.addEventListener('hashchange', change);
    return () => {
      window.removeEventListener('hashchange', change);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${unread ? `(${unread}) ` : ''}SignTalk — ${t('Общение жестами, текстом и видео', 'Ыммен, мәтінмен және бейнемен сөйлесу')}`;
  }, [lang, t, unread]);
  // A video call needs the camera: release it from the recognition pages first.
  useEffect(
    () =>
      calls.subscribe(() => {
        if (calls.busy) {
          session.stopCamera();
          session.stopReplay();
        }
      }),
    [session],
  );
  useEffect(() => {
    try {
      localStorage.setItem('signtalk.cloudModel', model);
      localStorage.setItem('signtalk.large', String(large));
      localStorage.setItem('signtalk.contrast', String(contrast));
    } catch {
      /* private storage */
    }
  }, [model, large, contrast]);
  useEffect(() => {
    session.stopCamera();
    session.stopReplay();
    if (page !== 'recognition') session.setRecognitionEnabled(false);
    if (page === 'dataset' || page === 'gestures') session.warmUp();
    return () => {
      session.stopCamera();
      session.stopReplay();
    };
  }, [page, session]);
  const pick = (text: string) => {
    conversation.setDraft(text);
    location.hash = 'recognition';
  };
  const nav = [
    { id: 'chats', icon: MessageCircle, title: t('Чаты', 'Чаттар') },
    { id: 'recognition', icon: Camera, title: t('Распознавание', 'Тану') },
    { id: 'gestures', icon: BookOpen, title: t('Словарь', 'Сөздік') },
    { id: 'help', icon: CircleHelp, title: t('Помощь', 'Көмек') },
  ];
  const sectionIndex = nav.findIndex((item) => item.id === page);
  const titles: Record<Page, string> = {
    chats: t('Чаты и видеозвонки', 'Чаттар және бейнеқоңыраулар'),
    profile: t('Профиль и устройства', 'Профиль және құрылғылар'),
    talk: t('Ответ собеседника', 'Әңгімелесушінің жауабы'),
    recognition: t('Распознавание жестов и губ', 'Ымды және ерінді тану'),
    gestures: t('Словарь и примеры', 'Сөздік және мысалдар'),
    dataset: t('Сбор примеров', 'Мысал жинау'),
    help: t('Для кого и как это работает', 'Кімге арналған және қалай жұмыс істейді'),
    settings: t('Настройки', 'Баптаулар'),
  };
  return (
    <div
      className={`product-shell ${large ? 'large-text ' : ''}${contrast ? 'high-contrast' : ''}`}
    >
      <a href="#main-content" className="skip-link">
        {t('Перейти к содержимому', 'Мазмұнға өту')}
      </a>
      <header className="product-header">
        <a href="#chats" className="brand">
          <span className="brand-icon">
            <LiveHand />
          </span>
          <span>
            SignTalk<span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="product-nav" aria-label={t('Разделы', 'Бөлімдер')}>
          <div className="product-nav-inner">
            {nav.map((item, index) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <span className="nav-index" aria-hidden>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <item.icon size={18} aria-hidden />
                <span>{item.title}</span>
                {item.id === 'chats' && unread ? (
                  <span
                    className="nav-badge"
                    aria-label={t(`${unread} непрочитанных`, `${unread} оқылмаған`)}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        </nav>
        <div className="header-tools">
          <div
            className="locale-switch"
            role="group"
            aria-label={t('Язык интерфейса', 'Интерфейс тілі')}
          >
            <Globe2 size={15} aria-hidden />
            {(['kk', 'ru'] as const).map((l) => (
              <button
                key={l}
                aria-pressed={lang === l}
                onClick={() => {
                  setLocale(l);
                }}
              >
                {l === 'kk' ? 'ҚАЗ' : 'РУС'}
              </button>
            ))}
          </div>
          <a className="icon-tool" href="#settings" aria-label={t('Настройки', 'Баптаулар')}>
            <Settings2 size={19} aria-hidden />
          </a>
          <a
            className="account-chip"
            href="#profile"
            aria-current={page === 'profile' ? 'page' : undefined}
            aria-label={
              account.user
                ? t(`Профиль: ${account.user.displayName}`, `Профиль: ${account.user.displayName}`)
                : t('Войти', 'Кіру')
            }
          >
            <span className="chip-avatar" aria-hidden>
              {account.user ? initials(account.user.displayName) : '→'}
            </span>
            <span>{account.user ? account.user.displayName : t('Войти', 'Кіру')}</span>
          </a>
        </div>
      </header>
      <main id="main-content" className="product-main" tabIndex={-1}>
        <BuildNotice />
        <div className={`page-heading ${page === 'chats' ? 'compact' : ''}`}>
          <div>
            <p className="page-kicker">
              {sectionIndex >= 0 ? (
                <>
                  <span className="kicker-index">
                    {String(sectionIndex + 1).padStart(2, '0')} /{' '}
                    {String(nav.length).padStart(2, '0')}
                  </span>
                  <span className="kicker-sep" aria-hidden />
                </>
              ) : null}
              <span>{t('Жесты → понятный текст', 'Ым → түсінікті мәтін')}</span>
            </p>
            <h1>{titles[page]}</h1>
            {page === 'talk' ? (
              <p>
                {t(
                  'Пишите сообщения и читайте ответы собеседника.',
                  'Хабарлама жазыңыз және әңгімелесушінің жауабын оқыңыз.',
                )}
              </p>
            ) : null}
          </div>
          <div className="accessibility-tools">
            <button
              aria-pressed={large}
              onClick={() => {
                setLarge(!large);
              }}
              aria-label={t('Крупный текст', 'Ірі мәтін')}
            >
              Aa
            </button>
            <button
              aria-pressed={contrast}
              onClick={() => {
                setContrast(!contrast);
              }}
              aria-label={t('Высокий контраст', 'Жоғары контраст')}
            >
              <Eye size={18} aria-hidden />
            </button>
          </div>
        </div>
        <Suspense fallback={<p role="status">{t('Открываем раздел…', 'Бөлім ашылуда…')}</p>}>
          {page === 'chats' || page === 'profile' ? (
            account.auth === 'checking' ? (
              <p role="status">{t('Проверяем вход…', 'Кіру тексерілуде…')}</p>
            ) : account.auth === 'anon' ? (
              <AuthPage />
            ) : page === 'chats' ? (
              <ChatsPage />
            ) : (
              <ProfilePage />
            )
          ) : page === 'talk' ? (
            <ConversationPage language={language} setLanguage={changeLanguage} model={model} />
          ) : page === 'recognition' ? (
            <RecognitionPage
              session={session}
              language={language}
              setLanguage={changeLanguage}
              model={model}
              onPick={pick}
            />
          ) : page === 'gestures' ? (
            <>
              <GesturePage />
              <details className="content-card">
                <summary>
                  {t('Проверить KRSL без камеры', 'KRSL моделін камерасыз тексеру')}
                </summary>
                <NativePanel
                  kind="krsl"
                  session={session}
                  output={language}
                  onPick={pick}
                  samplesOnly
                />
              </details>
            </>
          ) : page === 'dataset' ? (
            <DatasetPanel session={session} />
          ) : page === 'help' ? (
            <HelpPage />
          ) : (
            <SettingsPage
              language={language}
              setLanguage={changeLanguage}
              model={model}
              setModel={setModel}
              large={large}
              setLarge={setLarge}
              contrast={contrast}
              setContrast={setContrast}
            />
          )}
        </Suspense>
      </main>
      {account.auth === 'ready' ? (
        <Suspense fallback={null}>
          <CallOverlay />
        </Suspense>
      ) : null}
      <footer className="product-footer">
        <span>
          <LiveHand still className="footer-mark" />
          SignTalk · {t('Версия', 'Нұсқа')} {version}
        </span>
        <a href="#help">{t('О приложении и конфиденциальности', 'Қолданба және құпиялылық')}</a>
      </footer>
    </div>
  );
}
