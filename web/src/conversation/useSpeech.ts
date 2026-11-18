import { useEffect, useRef, useState } from 'react';
import { type Locale, useLocale } from '../locale';
import { CaptionSession, recognitionFactory } from './captions';
import { useRecognitionPreferences } from '../recognition/preferences';
export function useConversationSpeech(language: Locale, onFinal: (text: string) => void) {
  const { t } = useLocale();
  const { speechRate } = useRecognitionPreferences();
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [notice, setNotice] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const final = useRef(onFinal);
  useEffect(() => {
    final.current = onFinal;
  }, [onFinal]);
  const captions = useRef<CaptionSession | null>(null);
  useEffect(() => {
    const c = new CaptionSession({
      final: (text) => {
        final.current(text);
      },
      interim: setPartial,
      state: setListening,
      error: (code) => {
        setNotice(
          code === 'not-allowed'
            ? t(
                'Микрофон недоступен. Разрешите доступ или напишите ответ.',
                'Микрофон қолжетімсіз. Рұқсат беріңіз немесе жауап жазыңыз.',
              )
            : t(
                'Не удалось расслышать. Попробуйте ещё раз или введите ответ.',
                'Сөзді тану мүмкін болмады. Қайталаңыз немесе жауап енгізіңіз.',
              ),
        );
      },
    });
    captions.current = c;
    const stop = () => {
      c.stop();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      stop();
      captions.current = null;
    };
  }, [language, t]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refresh = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refresh);
    };
  }, []);
  const start = () => {
    const Ctor = recognitionFactory();
    setNotice('');
    if (Ctor) captions.current?.start(Ctor, language);
  };
  const stop = () => {
    captions.current?.stop();
  };
  const speak = (text: string, speechLanguage: Locale = language) => {
    stop();
    setNotice('');
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(speechLanguage));
    if (!voice || !('speechSynthesis' in window)) {
      setNotice(
        t(
          'Голос этого языка недоступен. Покажите сообщение на экране.',
          'Бұл тілдің дауысы қолжетімсіз. Хабарламаны экранда көрсетіңіз.',
        ),
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage === 'kk' ? 'kk-KZ' : 'ru-RU';
    utterance.voice = voice;
    utterance.rate = speechRate;
    utterance.onerror = () => {
      setNotice(
        t(
          'Не удалось озвучить. Текст остаётся на экране.',
          'Дыбыстау мүмкін болмады. Мәтін экранда қалады.',
        ),
      );
    };
    window.speechSynthesis.speak(utterance);
  };
  return {
    listening,
    partial,
    notice,
    setNotice,
    start,
    stop,
    speak,
    available: !!recognitionFactory(),
    stopVoice: () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
  };
}
