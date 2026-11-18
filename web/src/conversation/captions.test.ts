import { expect, it, vi } from 'vitest';
import { CaptionSession, type SpeechRecognitionLike, type SpeechEvent } from './captions';
class Recognition implements SpeechRecognitionLike {
  static last: Recognition;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  abort = vi.fn();
  start = vi.fn();
  constructor() {
    Recognition.last = this;
  }
}
const event = (items: [string, boolean][], resultIndex = 0): SpeechEvent => ({
  resultIndex,
  results: items.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
});
it('shows live interim captions and commits each final result once, without overwriting previous turns', () => {
  const events = { final: vi.fn(), interim: vi.fn(), state: vi.fn(), error: vi.fn() };
  const session = new CaptionSession(events);
  session.start(Recognition, 'ru');
  const recognition = Recognition.last;
  expect(recognition).toMatchObject({ lang: 'ru-RU', continuous: true, interimResults: true });
  recognition.onresult?.(event([['До пятницы', false]]));
  expect(events.final).not.toHaveBeenCalled();
  expect(events.interim).toHaveBeenLastCalledWith('До пятницы');
  recognition.onresult?.(event([['До пятницы', true]]));
  recognition.onresult?.(
    event(
      [
        ['До пятницы', true],
        ['В 15:00', false],
      ],
      1,
    ),
  );
  recognition.onresult?.(
    event(
      [
        ['До пятницы', true],
        ['В 15:00', true],
      ],
      1,
    ),
  );
  recognition.onresult?.(
    event([
      ['До пятницы', true],
      ['В 15:00', true],
    ]),
  );
  expect(events.final.mock.calls).toEqual([['До пятницы'], ['В 15:00']]);
  expect(events.interim).toHaveBeenLastCalledWith('');
});
it('ignores late events after stop or a new recognition session and aborts old audio', () => {
  const events = { final: vi.fn(), interim: vi.fn(), state: vi.fn(), error: vi.fn() };
  const session = new CaptionSession(events);
  session.start(Recognition, 'ru');
  const old = Recognition.last;
  const late = old.onresult;
  session.start(Recognition, 'kk');
  expect(old.abort).toHaveBeenCalled();
  expect(Recognition.last.lang).toBe('kk-KZ');
  late?.(event([['Старый ответ', true]]));
  session.stop();
  late?.(event([['Ещё один старый ответ', true]]));
  expect(events.final).not.toHaveBeenCalled();
  expect(events.state).toHaveBeenLastCalledWith(false);
});
it('leaves microphone state off after an error or the service ending', () => {
  const events = { final: vi.fn(), interim: vi.fn(), state: vi.fn(), error: vi.fn() };
  const session = new CaptionSession(events);
  session.start(Recognition, 'ru');
  Recognition.last.onerror?.({ error: 'not-allowed' });
  expect(events.error).toHaveBeenCalledWith('not-allowed');
  expect(events.state).toHaveBeenLastCalledWith(false);
  session.start(Recognition, 'ru');
  Recognition.last.onend?.();
  expect(events.state).toHaveBeenLastCalledWith(false);
});
