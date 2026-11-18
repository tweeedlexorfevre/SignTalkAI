import type { Locale } from '../locale';
export interface SpeechResult {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
}
export interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult | undefined };
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}
export type RecognitionFactory = new () => SpeechRecognitionLike;
export function recognitionFactory(): RecognitionFactory | undefined {
  const w = window as Window & {
    SpeechRecognition?: RecognitionFactory;
    webkitSpeechRecognition?: RecognitionFactory;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
export class CaptionSession {
  private recognition: SpeechRecognitionLike | null = null;
  constructor(
    private readonly events: {
      final: (text: string) => void;
      interim: (text: string) => void;
      state: (on: boolean) => void;
      error: (code: string) => void;
    },
  ) {}
  start(Ctor: RecognitionFactory, language: Locale) {
    this.stop();
    const r = new Ctor();
    this.recognition = r;
    const committed = new Set<number>();
    r.lang = language === 'kk' ? 'kk-KZ' : 'ru-RU';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      if (this.recognition !== r) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript.trim();
        if (result?.isFinal && text && !committed.has(i)) {
          committed.add(i);
          this.events.final(text);
        }
      }
      const partial = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && !result.isFinal) partial.push(result[0]?.transcript ?? '');
      }
      this.events.interim(partial.join(' ').trim());
    };
    r.onerror = (e) => {
      if (this.recognition !== r) return;
      this.stop();
      this.events.error(e.error);
    };
    r.onend = () => {
      if (this.recognition !== r) return;
      this.stop();
    };
    try {
      r.start();
      this.events.state(true);
    } catch {
      this.stop();
      this.events.error('start-failed');
    }
  }
  stop() {
    const r = this.recognition;
    this.recognition = null;
    if (r) {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.abort();
    }
    this.events.interim('');
    this.events.state(false);
  }
}
