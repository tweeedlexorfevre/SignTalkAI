import vocabulary from './vocabulary.json';
import { useCallback, useSyncExternalStore } from 'react';
import messages from './locale-messages.json';
export type Locale = 'ru' | 'kk';
let locale: Locale = 'ru';
try {
  if (localStorage.getItem('signtalk.locale') === 'kk') locale = 'kk';
} catch {
  /* private mode */
}
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export function setLocale(value: Locale) {
  locale = value;
  document.documentElement.lang = value;
  try {
    localStorage.setItem('signtalk.locale', value);
  } catch {
    /* private mode */
  }
  listeners.forEach((f) => {
    f();
  });
}
export function useLocale() {
  const lang = useSyncExternalStore(subscribe, () => locale);
  const t = useCallback((ru: string, kk: string) => (lang === 'kk' ? kk : ru), [lang]);
  return { lang, t };
}
export function tr(text: string): string {
  const pair = (messages as Record<string, string[]>)[text];
  return pair?.[locale === 'kk' ? 1 : 0] ?? text;
}

export function signTitle(sign: string | null, fallback: string): string {
  return sign
    ? ((vocabulary as Record<string, Record<Locale, string>>)[sign]?.[locale] ?? fallback)
    : fallback;
}
