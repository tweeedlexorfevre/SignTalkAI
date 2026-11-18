/** Browser side of lip reading: talks to /api/lipread/* on this origin. */
import type { Locale } from '../locale';

export interface LipreadStatus {
  online: boolean;
  ready: boolean;
  loading?: boolean;
  error?: string | null;
  device?: string;
}

export interface LipreadResult {
  text: string;
  seconds: number;
}

export async function lipreadStatus(signal?: AbortSignal): Promise<LipreadStatus> {
  try {
    const r = await fetch('/api/lipread/status', { signal: signal ?? null });
    if (!r.ok) return { online: false, ready: false };
    return (await r.json()) as LipreadStatus;
  } catch {
    return { online: false, ready: false };
  }
}

export async function recognizeLips(clip: Blob, signal?: AbortSignal): Promise<LipreadResult> {
  const type = clip.type.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  let r: Response;
  try {
    r = await fetch('/api/lipread/recognize', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: clip,
      signal: signal ?? null,
    });
  } catch {
    throw new Error('network');
  }
  const body = (await r.json().catch(() => ({}))) as Partial<LipreadResult> & { error?: string };
  if (!r.ok || typeof body.text !== 'string') throw new Error(body.error ?? 'recognition_failed');
  return { text: body.text, seconds: body.seconds ?? 0 };
}

const MESSAGES: Record<string, [string, string]> = {
  lipread_offline: [
    'Сервис чтения по губам не запущен. Запустите его командой npm run lipread.',
    'Ерін оқу қызметі іске қосылмаған. npm run lipread командасымен іске қосыңыз.',
  ],
  lipread_loading: [
    'Модель ещё загружается. Подождите несколько секунд.',
    'Модель әлі жүктелуде. Бірнеше секунд күтіңіз.',
  ],
  no_face: [
    'Лицо или губы не найдены. Смотрите в камеру, лицо должно быть хорошо освещено.',
    'Бет немесе ерін табылмады. Камераға қараңыз, бетіңіз жақсы жарықтандырылсын.',
  ],
  invalid_video: ['Не удалось прочитать видео.', 'Бейнені оқу мүмкін болмады.'],
  file_too_large: ['Видео слишком большое.', 'Бейне тым үлкен.'],
  request_busy: ['Предыдущая запись ещё распознаётся.', 'Алдыңғы жазба әлі танылуда.'],
  network: ['Нет связи с сервером.', 'Сервермен байланыс жоқ.'],
};

export function lipreadMessage(code: string, lang: Locale): string {
  const pair = MESSAGES[code] ?? [
    'Не удалось распознать. Попробуйте ещё раз.',
    'Тану мүмкін болмады. Қайталап көріңіз.',
  ];
  return lang === 'kk' ? pair[1] : pair[0];
}
