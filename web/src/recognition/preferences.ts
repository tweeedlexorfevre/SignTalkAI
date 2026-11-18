import { useSyncExternalStore } from 'react';
export interface RecognitionPreferences {
  /** What the camera reads: sign language (hands) or lip reading (mouth). */
  method: 'signs' | 'lips';
  engine: 'cloud' | 'local';
  signLanguage: 'krsl' | 'rsl' | 'bukva' | 'asl';
  vocabulary: 'krsl10' | 'free';
  countdown: 1 | 3 | 5;
  cloudSeconds: 3 | 5 | 8;
  showSkeleton: boolean;
  mirror: boolean;
  speechRate: 0.8 | 1 | 1.2;
}
export const DEFAULT_PREFERENCES: RecognitionPreferences = {
  method: 'signs',
  engine: 'cloud',
  signLanguage: 'krsl',
  vocabulary: 'krsl10',
  countdown: 3,
  cloudSeconds: 5,
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
    method: value.method === 'lips' ? 'lips' : 'signs',
    engine: value.engine === 'local' ? 'local' : 'cloud',
    signLanguage:
      value.signLanguage === 'asl' || value.signLanguage === 'rsl' || value.signLanguage === 'bukva'
        ? value.signLanguage
        : 'krsl',
    vocabulary: value.vocabulary === 'free' ? 'free' : 'krsl10',
    countdown: value.countdown === 1 || value.countdown === 5 ? value.countdown : 3,
    cloudSeconds: value.cloudSeconds === 3 || value.cloudSeconds === 8 ? value.cloudSeconds : 5,
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
