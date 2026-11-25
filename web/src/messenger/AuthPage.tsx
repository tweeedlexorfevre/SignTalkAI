import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { ArrowRight, Eye, EyeOff, MessageCircle, Video, Smartphone } from 'lucide-react';
import { LiveHand } from '../components/brand/LiveHand';
import { DotField } from '../components/brand/DotField';
import { TypeText } from '../components/brand/TypeText';

/** Example meanings for the decorative readout (the user's own gestures carry their own names). */
const krslLabels = [
  { ru: 'Привет', kk: 'Сәлем' },
  { ru: 'Спасибо', kk: 'Рақмет' },
  { ru: 'Можно', kk: 'Болады' },
  { ru: 'Нельзя', kk: 'Болмайды' },
  { ru: 'Надо', kk: 'Керек' },
  { ru: 'Не надо', kk: 'Керек емес' },
];
import { useLocale } from '../locale';
import { ApiError, errorText } from './api';
import { messenger } from './store';

const shortWord = (s: string) => s.replace(/\s*\(.*?\)/, '');

/** Decorative hero: the hand cycles through shapes while a demo readout types KRSL words. */
function AuthShowcase() {
  const { lang, t } = useLocale();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((n) => n + 1);
    }, 2600);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  const i = step % krslLabels.length;
  const label = krslLabels[i];
  const other = lang === 'ru' ? 'kk' : 'ru';
  const pct = `${Math.round((0.71 + ((step * 37) % 24) / 100) * 100)}%`;
  return (
    <>
      <span className="auth-art">
        <LiveHand mode="hero" pose={i % 6} labels />
      </span>
      {label ? (
        <div className="auth-readout" aria-hidden>
          <div>
            <small>
              {t('Жест', 'Ым')} {String(i + 1).padStart(2, '0')} / {krslLabels.length} →{' '}
              {t('текст', 'мәтін')}
            </small>
            <strong>
              <TypeText text={shortWord(label[lang])} />
            </strong>
            <small>{shortWord(label[other])}</small>
          </div>
          <div>
            <small>{t('Точек', 'Нүкте')}</small>
            <b>
              21<span>/21</span>
            </b>
          </div>
          <div>
            <small>{t('Уверенность', 'Сенімділік')}</small>
            <b>{pct}</b>
            <span className="readout-bar">
              <span style={{ width: pct }} />
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function AuthPage() {
  const { t } = useLocale();
  const uid = useId();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      if (mode === 'login') await messenger.login(login.trim(), password);
      else await messenger.register(username.trim(), displayName.trim(), password);
      location.hash = 'chats';
    } catch (err) {
      setError(errorText(err, t));
      if (err instanceof ApiError) setFieldErrors(err.details);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setFieldErrors({});
  };

  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <DotField alpha={0.09} />
        <span className="auth-badge">SignTalk · 21 {t('точка руки', 'қол нүктесі')}</span>
        <h2>
          {t(
            'Общение без барьеров: текст, видео и ',
            'Кедергісіз қарым-қатынас: мәтін, бейне және ',
          )}
          <em>{t('жесты', 'ым')}</em>
        </h2>
        <AuthShowcase />
        <ul>
          <li>
            <MessageCircle size={20} aria-hidden />
            <span>
              {t(
                'Переписка в реальном времени. Найдите собеседника по уникальному ID.',
                'Нақты уақыттағы хат алмасу. Әңгімелесушіні бірегей ID бойынша табыңыз.',
              )}
            </span>
          </li>
          <li>
            <Video size={20} aria-hidden />
            <span>
              {t(
                'Видеозвонок с переводом жестов в текст прямо во время разговора.',
                'Сөйлесу кезінде ымды мәтінге аударатын бейнеқоңырау.',
              )}
            </span>
          </li>
          <li>
            <Smartphone size={20} aria-hidden />
            <span>
              {t(
                'Один аккаунт на телефоне, ноутбуке и планшете одновременно.',
                'Бір аккаунт телефонда, ноутбукта және планшетте бір уақытта.',
              )}
            </span>
          </li>
        </ul>
      </section>
      <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate>
        <div
          className="engine-switch auth-tabs"
          role="group"
          aria-label={t('Вход или регистрация', 'Кіру немесе тіркелу')}
        >
          <button
            type="button"
            aria-pressed={mode === 'login'}
            onClick={() => {
              switchMode('login');
            }}
          >
            {t('Вход', 'Кіру')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            onClick={() => {
              switchMode('register');
            }}
          >
            {t('Регистрация', 'Тіркелу')}
          </button>
        </div>
        {mode === 'login' ? (
          <div className="auth-field">
            <label htmlFor={`${uid}-login`}>
              {t('Имя пользователя или ID', 'Пайдаланушы аты немесе ID')}
            </label>
            <input
              id={`${uid}-login`}
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="aliya / ST-7KQ2MX"
            />
          </div>
        ) : (
          <>
            <div className="auth-field">
              <label htmlFor={`${uid}-name`}>
                {t('Ваше имя (видно собеседникам)', 'Атыңыз (әңгімелесушілерге көрінеді)')}
              </label>
              <input
                id={`${uid}-name`}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                }}
                autoComplete="name"
                maxLength={40}
                required
                aria-invalid={!!fieldErrors['displayName']}
              />
            </div>
            <div className="auth-field">
              <label htmlFor={`${uid}-username`}>
                {t('Имя пользователя для входа', 'Кіруге арналған пайдаланушы аты')}
              </label>
              <input
                id={`${uid}-username`}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={24}
                required
                aria-invalid={!!fieldErrors['username']}
                aria-describedby={`${uid}-username-hint`}
              />
              <small id={`${uid}-username-hint`}>
                {t(
                  '3–24 символа: латиница, цифры, «_» и «.»',
                  '3–24 таңба: латын әріптері, сандар, «_» және «.»',
                )}
              </small>
            </div>
          </>
        )}
        <div className="auth-field">
          <label htmlFor={`${uid}-password`}>{t('Пароль', 'Құпиясөз')}</label>
          <span className="password-row">
            <input
              id={`${uid}-password`}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              maxLength={128}
              required
              aria-invalid={!!fieldErrors['password']}
              aria-describedby={mode === 'register' ? `${uid}-password-hint` : undefined}
            />
            <button
              type="button"
              onClick={() => {
                setShow(!show);
              }}
              aria-pressed={show}
              aria-label={t('Показать пароль', 'Құпиясөзді көрсету')}
            >
              {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </span>
          {mode === 'register' ? (
            <small id={`${uid}-password-hint`}>{t('Минимум 8 символов', 'Кемінде 8 таңба')}</small>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="auth-error">
            {error}
          </p>
        ) : null}
        <button className="auth-submit" type="submit" disabled={busy}>
          <span>
            {busy
              ? t('Подождите…', 'Күте тұрыңыз…')
              : mode === 'login'
                ? t('Войти', 'Кіру')
                : t('Создать аккаунт', 'Аккаунт ашу')}
          </span>
          <ArrowRight size={20} aria-hidden />
        </button>
        <p className="auth-note">
          {mode === 'login'
            ? t('Нет аккаунта? ', 'Аккаунт жоқ па? ')
            : t('Уже есть аккаунт? ', 'Аккаунт бар ма? ')}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              switchMode(mode === 'login' ? 'register' : 'login');
            }}
          >
            {mode === 'login' ? t('Зарегистрируйтесь', 'Тіркеліңіз') : t('Войдите', 'Кіріңіз')}
          </button>
        </p>
        <p className="auth-note auth-id-note">
          <span className="id-tag" aria-hidden>
            ST-
          </span>
          {t(
            'После регистрации вы получите уникальный ID — поделитесь им, чтобы вас нашли.',
            'Тіркелгеннен кейін бірегей ID аласыз — сізді табу үшін оны бөлісіңіз.',
          )}
        </p>
      </form>
    </div>
  );
}
