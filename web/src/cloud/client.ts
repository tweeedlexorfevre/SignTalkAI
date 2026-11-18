import type { Locale } from '../locale';
export type SignLanguage = 'krsl' | 'rsl' | 'asl';
export interface CloudResult {
  status: 'recognized' | 'uncertain';
  text: string;
  model: string;
  vocabulary?: 'krsl10';
  signId?: string;
}
export const MODEL_OPTIONS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-4-argon'];
export class CloudRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function requestCloud(
  video: Blob,
  language: SignLanguage,
  output: Locale,
  model: string,
  signal: AbortSignal,
  vocabulary: 'krsl10' | 'free' = 'free',
): Promise<CloudResult> {
  if (!video.size || video.size > 12 * 1024 * 1024) throw new CloudRequestError('file_too_large');
  const response = await fetch('/api/cloud/recognize', {
    method: 'POST',
    headers: {
      'Content-Type': video.type.split(';')[0] ?? 'video/webm',
      'x-signtalk-consent': 'yes',
      'x-sign-language': language,
      'x-output-language': output,
      'x-signtalk-model': model,
      'x-sign-vocabulary': vocabulary,
    },
    body: video,
    signal,
  });
  const data = (await response.json()) as Partial<CloudResult> & { error?: string };
  if (!response.ok) throw new CloudRequestError(data.error ?? 'server_error');
  if (
    !['recognized', 'uncertain'].includes(data.status ?? '') ||
    typeof data.text !== 'string' ||
    typeof data.model !== 'string'
  )
    throw new CloudRequestError('invalid_response');
  return data as CloudResult;
}
export function cloudMessage(code: string, lang: Locale): string {
  const messages: Record<string, [string, string]> = {
    quota_zero: [
      'Для этой модели у ключа нулевая квота. Выберите другую модель в настройках или измените квоту Google.',
      'Бұл модель үшін кілт квотасы нөл. Баптаудан басқа модель таңдаңыз немесе Google квотасын өзгертіңіз.',
    ],
    rate_limit: [
      'Лимит запросов исчерпан. Попробуйте позже.',
      'Сұраулар шегі аяқталды. Кейінірек көріңіз.',
    ],
    request_busy: [
      'Предыдущий запрос ещё выполняется. Подождите немного.',
      'Алдыңғы сұрау орындалуда. Сәл күтіңіз.',
    ],
    invalid_key: [
      'Google отклонил ключ. Обновите ключ на сервере.',
      'Google кілтті қабылдамады. Сервердегі кілтті жаңартыңыз.',
    ],
    not_configured: [
      'Облачный ИИ не подключён. Добавьте ключ на сервере или выберите режим на устройстве.',
      'Бұлттық ЖИ қосылмаған. Серверге кілт қосыңыз немесе құрылғы режимін таңдаңыз.',
    ],
    provider_busy: [
      'Сервис Google перегружен. Повторите позже или выберите другую модель.',
      'Google қызметі жүктелген. Кейінірек қайталаңыз немесе басқа модель таңдаңыз.',
    ],
    model_unavailable: [
      'Эта модель сейчас недоступна. Выберите другую в настройках.',
      'Бұл модель қазір қолжетімсіз. Баптаудан басқасын таңдаңыз.',
    ],
    invalid_response: [
      'ИИ вернул непонятный ответ. Попробуйте ещё раз.',
      'ЖИ түсініксіз жауап берді. Қайта көріңіз.',
    ],
    incomplete: [
      'ИИ не завершил ответ. Повторите короткий жест.',
      'ЖИ жауабын аяқтамады. Қысқа ымды қайталаңыз.',
    ],
    timeout: [
      'Ответ занял слишком много времени. Повторите позже.',
      'Жауап тым ұзаққа созылды. Кейінірек қайталаңыз.',
    ],
    file_too_large: [
      'Выберите видео до 12 МБ и 15 секунд.',
      '12 МБ және 15 секундтан аспайтын бейне таңдаңыз.',
    ],
    invalid_video: [
      'Не удалось прочитать видео. Используйте WebM или MP4.',
      'Бейнені оқу мүмкін болмады. WebM немесе MP4 пайдаланыңыз.',
    ],
  };
  return (
    messages[code]?.[lang === 'kk' ? 1 : 0] ??
    (lang === 'kk'
      ? 'Қызметке қосылу мүмкін болмады. Қайта көріңіз.'
      : 'Не удалось связаться с сервисом. Попробуйте ещё раз.')
  );
}
