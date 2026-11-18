import type { Message } from './api';

type T = (ru: string, kk: string) => string;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0], parts[1]] : [parts[0]]).map((p) => p?.[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** A stable hue per user ID, for avatar colours. */
export function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function clock(ms: number, lang: string): string {
  return new Date(ms).toLocaleTimeString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortDate(ms: number, lang: string): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(ms, lang);
  return d.toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

export function dayLabel(ms: number, lang: string, t: T): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('Сегодня', 'Бүгін');
  if (d.toDateString() === yesterday.toDateString()) return t('Вчера', 'Кеше');
  return d.toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export function parseCallBody(body: string): { status: string; duration: number } {
  try {
    const value = JSON.parse(body) as { status?: unknown; duration?: unknown };
    return {
      status: typeof value.status === 'string' ? value.status : 'completed',
      duration: typeof value.duration === 'number' ? value.duration : 0,
    };
  } catch {
    return { status: 'completed', duration: 0 };
  }
}

/** "Video call · 2:15", "Missed call", ... from the point of view of `me`. */
export function callText(message: Message, me: string | undefined, t: T): string {
  const { status, duration: seconds } = parseCallBody(message.body);
  const outgoing = message.from === me;
  switch (status) {
    case 'completed':
      return `${t('Видеозвонок', 'Бейнеқоңырау')} · ${duration(seconds)}`;
    case 'missed':
      return outgoing
        ? t('Нет ответа', 'Жауап жоқ')
        : t('Пропущенный звонок', 'Қабылданбаған қоңырау');
    case 'declined':
      return outgoing
        ? t('Звонок отклонён', 'Қоңырау қабылданбады')
        : t('Вы отклонили звонок', 'Сіз қоңырауды қабылдамадыңыз');
    case 'cancelled':
      return outgoing
        ? t('Звонок отменён', 'Қоңырау тоқтатылды')
        : t('Пропущенный звонок', 'Қабылданбаған қоңырау');
    case 'busy':
      return t('Абонент занят', 'Абонент бос емес');
    default:
      return t('Звонок не состоялся', 'Қоңырау болмады');
  }
}

/** One-line preview of a message for the chat list. */
export function preview(message: Message, me: string | undefined, t: T): string {
  if (message.kind === 'call') return callText(message, me, t);
  const prefix = message.from === me ? t('Вы: ', 'Сіз: ') : '';
  const kind =
    message.kind === 'sign'
      ? t('Жест: ', 'Ым: ')
      : message.kind === 'speech'
        ? t('Речь: ', 'Сөйлеу: ')
        : '';
  return `${prefix}${kind}${message.body}`;
}

export function endText(status: string | null, reason: string | null, t: T): string {
  if (reason === 'offline') return t('Собеседник не в сети', 'Әңгімелесуші желіде емес');
  if (reason === 'busy' || status === 'busy')
    return t('Собеседник занят другим звонком', 'Әңгімелесуші басқа қоңырауда');
  if (reason === 'not_contact')
    return t('Сначала добавьте человека в контакты', 'Алдымен адамды контактілерге қосыңыз');
  if (reason === 'self_busy')
    return t('У вас уже идёт звонок на другом устройстве', 'Басқа құрылғыда қоңырау жүріп жатыр');
  if (reason === 'offline_self' || reason === 'connection_lost')
    return t('Нет связи с сервером', 'Сервермен байланыс жоқ');
  if (reason === 'network')
    return t('Не удалось установить видеосвязь (сеть)', 'Бейнебайланыс орнатылмады (желі)');
  if (reason === 'gone') return t('Звонок уже завершён', 'Қоңырау аяқталған');
  switch (status) {
    case 'missed':
      return t('Нет ответа', 'Жауап жоқ');
    case 'declined':
      return t('Звонок отклонён', 'Қоңырау қабылданбады');
    case 'cancelled':
      return t('Звонок отменён', 'Қоңырау тоқтатылды');
    case 'completed':
      return t('Звонок завершён', 'Қоңырау аяқталды');
    default:
      return t('Звонок не состоялся', 'Қоңырау болмады');
  }
}
