import { useSyncExternalStore } from 'react';
export interface RecognitionPreferences {
  /** What the camera reads: the user's own gestures or the Russian fingerspelling alphabet. */
  signLanguage: 'personal' | 'bukva';
  showSkeleton: boolean;
  mirror: boolean;
  speechRate: 0.8 | 1 | 1.2;
}
export const DEFAULT_PREFERENCES: RecognitionPreferences = {
  signLanguage: 'personal',
  showSkeleton: true,
  mirror: true,
  speechRate: 1,
};
export function parsePreferences(raw: string | null): RecognitionPreferences {
  let value: Partial<RecognitionPreferences> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') value = parsed;
  } catch {
    /* defaults */
  }
  return {
    signLanguage: value.signLanguage === 'bukva' ? 'bukva' : 'personal',
    showSkeleton: typeof value.showSkeleton === 'boolean' ? value.showSkeleton : true,
    mirror: typeof value.mirror === 'boolean' ? value.mirror : true,
    speechRate: value.speechRate === 0.8 || value.speechRate === 1.2 ? value.speechRate : 1,
  };
}
let current = DEFAULT_PREFERENCES;
try {
  current = parsePreferences(localStorage.getItem('signtalk.recognition'));
} catch {
  /* private storage */
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => current;
export function setRecognitionPreferences(patch: Partial<RecognitionPreferences>) {
  current = parsePreferences(JSON.stringify({ ...current, ...patch }));
  try {
    localStorage.setItem('signtalk.recognition', JSON.stringify(current));
  } catch {
    /* in-memory preferences still work */
  }
  listeners.forEach((listener) => {
    listener();
  });
}
export function useRecognitionPreferences() {
  return useSyncExternalStore(subscribe, snapshot);
}
