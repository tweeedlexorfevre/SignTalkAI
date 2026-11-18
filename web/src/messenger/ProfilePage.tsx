import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { LogOut, Monitor, Pencil, Share2, Smartphone, Trash2 } from 'lucide-react';
import { useLocale } from '../locale';
import { LiveHand } from '../components/brand/LiveHand';
import { errorText, type Device } from './api';
import { messenger, useMessenger } from './store';
import { CopyId } from './ChatsPage';
import { initials, shortDate } from './format';

const TIP_DOTS = new Set([4, 8, 12, 16, 20]);

export default function ProfilePage() {
  const { lang, t } = useLocale();
  const snap = useMessenger();
  const me = snap.user;
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.displayName ?? '');

  const load = useCallback(() => {
    messenger
      .devices()
      .then(setDevices)
      .catch((err: unknown) => {
        setError(errorText(err, t));
      });
  }, [t]);
  useEffect(() => {
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);

  if (!me) return null;

  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    try {
      await messenger.rename(name);
      setEditing(false);
      setError('');
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const shareText = t(
    `Найдите меня в SignTalk по ID ${me.id}`,
    `SignTalk-та мені ${me.id} ID бойынша табыңыз`,
  );

  return (
    <div className="profile-grid">
      <section className="profile-card id-pass">
        <span className="pass-scan" aria-hidden />
        <div className="pass-top">
          <span>SignTalk / {t('Пропуск', 'Рұқсатнама')}</span>
          <span className="pass-mark">
            <LiveHand />
          </span>
        </div>
        <div className="pass-person">
          <span className="pass-avatar" aria-hidden>
            {initials(me.displayName)}
          </span>
          <div>
            {editing ? (
              <form onSubmit={(e) => void save(e)} className="rename-form">
                <input
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                  aria-label={t('Ваше имя', 'Атыңыз')}
                  autoFocus
                />
                <button type="submit" className="pill-button">
                  {t('Сохранить', 'Сақтау')}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setEditing(false);
                    setName(me.displayName);
                  }}
                >
                  {t('Отмена', 'Бас тарту')}
                </button>
              </form>
            ) : (
              <h2>
                {me.displayName}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setEditing(true);
                  }}
                  aria-label={t('Изменить имя', 'Атын өзгерту')}
                >
                  <Pencil size={16} aria-hidden />
                </button>
              </h2>
            )}
            <p className="muted pass-handle">@{me.username}</p>
          </div>
        </div>
        <div className="id-block">
          <small>{t('Ваш уникальный ID', 'Сіздің бірегей ID')}</small>
          <span className="id-cells" aria-hidden>
            {me.id.split('').map((ch, i) => (
              <span
                key={i}
                className={i < 3 ? 'prefix' : ''}
                style={{ animationDelay: `${250 + i * 35}ms` }}
              >
                {ch}
              </span>
            ))}
          </span>
          <span className="id-dots" aria-hidden>
            {Array.from({ length: 21 }, (_, i) => (
              <span
                key={i}
                className={TIP_DOTS.has(i) ? 'tip' : ''}
                style={{ animationDelay: `${300 + i * 35}ms` }}
              />
            ))}
          </span>
          <CopyId id={me.id} />
          <p className="muted">
            {t(
              'Сообщите этот ID собеседнику — он найдёт вас через поиск в разделе «Чаты».',
              'Бұл ID-ді әңгімелесушіге айтыңыз — ол сізді «Чаттар» бөліміндегі іздеу арқылы табады.',
            )}
          </p>
          {'share' in navigator ? (
            <button
              type="button"
              className="pill-button share-button"
              onClick={() =>
                void navigator.share({ title: 'SignTalk', text: shareText }).catch(() => undefined)
              }
            >
              {t('Поделиться ID', 'ID бөлісу')}
              <Share2 size={18} aria-hidden />
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="add-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <section className="devices-card">
        <h2>{t('Устройства', 'Құрылғылар')}</h2>
        <p className="muted">
          {t(
            'Аккаунт работает на нескольких устройствах одновременно: сообщения приходят везде, звонок звонит на всех, а отвечаете вы на одном.',
            'Аккаунт бірнеше құрылғыда бір уақытта жұмыс істейді: хабарламалар барлығына келеді, қоңырау барлығында шырылдайды, ал жауапты біреуінде бересіз.',
          )}
        </p>
        {!devices ? (
          <p role="status">{t('Загрузка…', 'Жүктелуде…')}</p>
        ) : (
          <ul className="device-list">
            {devices.map((d) => {
              const phone = /iPhone|Android|iPad/.test(d.name);
              return (
                <li key={d.id} className={d.current ? 'current' : ''}>
                  <span className="device-icon">
                    {phone ? (
                      <Smartphone size={22} aria-hidden />
                    ) : (
                      <Monitor size={22} aria-hidden />
                    )}
                  </span>
                  <div>
                    <b>
                      {d.name}
                      {d.current ? (
                        <span className="tag">{t('это устройство', 'осы құрылғы')}</span>
                      ) : null}
                    </b>
                    <small>
                      {d.online ? (
                        <span className="online-text">{t('в сети', 'желіде')}</span>
                      ) : (
                        `${t('был(а) ', 'соңғы рет ')}${shortDate(d.lastSeenAt, lang)}`
                      )}
                      {' · '}
                      {t('вход ', 'кірген ')}
                      {shortDate(d.createdAt, lang)}
                    </small>
                  </div>
                  {!d.current ? (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() =>
                        void messenger
                          .revokeDevice(d.id)
                          .then(load)
                          .catch((err: unknown) => {
                            setError(errorText(err, t));
                          })
                      }
                      aria-label={t(`Выйти на устройстве ${d.name}`, `${d.name} құрылғысынан шығу`)}
                    >
                      <Trash2 size={17} aria-hidden />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="danger-button" onClick={() => void messenger.logout()}>
          <span>{t('Выйти на этом устройстве', 'Осы құрылғыдан шығу')}</span>
          <LogOut size={17} aria-hidden />
        </button>
      </section>
    </div>
  );
}
