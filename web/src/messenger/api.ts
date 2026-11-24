/** Typed client for the SignTalk messenger REST API (server/api.mjs). */

export interface User {
  /** Unique public ID, e.g. "ST-7KQ2MX". */
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  isAdmin?: boolean;
}

export type MessageKind = 'text' | 'sign' | 'speech' | 'call';

export interface Message {
  id: number;
  from: string;
  to: string;
  kind: MessageKind;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface Contact {
  user: User;
  online: boolean;
  addedAt: number;
  lastMessage: Message | null;
  unread: number;
}

export interface Device {
  id: number;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
  online: boolean;
}

export interface AuthResult {
  token: string;
  sessionId: number;
  user: User;
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, string> = {},
  ) {
    super(code);
  }
}

const TOKEN_KEY = 'signtalk.token';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts until reload */
  }
}

export async function request<T>(
  method: string,
  path: string,
  { token, body }: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: Record<string, string>;
  };
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'server_error', data.details);
  return data as T;
}

/** Russian/Kazakh text for an API error code. */
export function errorText(error: unknown, t: (ru: string, kk: string) => string): string {
  const code = error instanceof ApiError ? error.code : 'network';
  switch (code) {
    case 'network':
      return t(
        'Нет связи с сервером. Проверьте интернет.',
        'Сервермен байланыс жоқ. Интернетті тексеріңіз.',
      );
    case 'wrong_credentials':
      return t('Неверный логин или пароль.', 'Логин немесе құпиясөз қате.');
    case 'username_taken':
      return t('Это имя пользователя уже занято.', 'Бұл пайдаланушы аты бос емес.');
    case 'too_many_attempts':
      return t('Слишком много попыток. Подождите 10 минут.', 'Әрекет тым көп. 10 минут күтіңіз.');
    case 'user_not_found':
      return t('Пользователь с таким ID не найден.', 'Мұндай ID бар пайдаланушы табылмады.');
    case 'cannot_add_self':
      return t('Это ваш собственный ID.', 'Бұл — өзіңіздің ID.');
    case 'invalid_input':
      return t('Проверьте заполнение полей.', 'Өрістерді тексеріңіз.');
    case 'invalid_message':
      return t('Сообщение пустое или слишком длинное.', 'Хабарлама бос немесе тым ұзын.');
    case 'gesture_exists':
      return t(
        'В этом наборе уже есть жест с таким значением.',
        'Бұл жинақта мұндай мағыналы ым бар.',
      );
    case 'too_many_gestures':
      return t('Достигнут предел жестов.', 'Ымдар шегіне жетті.');
    case 'too_many_takes':
      return t('У жеста уже 5 повторов.', 'Ымда 5 қайталау бар.');
    case 'set_exists':
      return t('Набор с таким названием уже есть.', 'Мұндай атаулы жинақ бар.');
    case 'too_many_sets':
      return t('Достигнут предел наборов.', 'Жинақтар шегіне жетті.');
    case 'last_set':
      return t('Нельзя удалить последний набор.', 'Соңғы жинақты жоюға болмайды.');
    case 'set_not_found':
      return t('Набор уже удалён.', 'Жинақ жойылған.');
    case 'take_not_found':
      return t('Повтор уже удалён.', 'Қайталау жойылған.');
    case 'gesture_not_found':
      return t('Жест уже удалён.', 'Ым жойылған.');
    case 'unauthorized':
      return t('Сессия завершена. Войдите снова.', 'Сессия аяқталды. Қайта кіріңіз.');
    default:
      return t('Ошибка сервера. Попробуйте ещё раз.', 'Сервер қатесі. Қайталап көріңіз.');
  }
}
