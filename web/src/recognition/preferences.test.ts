import { expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences';
it('does not apply malformed or unsupported recognition preferences', () => {
  for (const raw of [
    null,
    'null',
    '{',
    '[]',
    '{"engine":"other","countdown":-10,"cloudSeconds":900,"showSkeleton":"false","mirror":3,"speechRate":100}',
  ])
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
});
it('restores supported settings without accepting arbitrary stored keys', () => {
  expect(
    parsePreferences(
      '{"method":"lips","engine":"local","signLanguage":"asl","vocabulary":"free","countdown":1,"cloudSeconds":8,"showSkeleton":false,"mirror":false,"speechRate":0.8,"secret":"ignored"}',
    ),
  ).toEqual({
    method: 'lips',
    engine: 'local',
    signLanguage: 'asl',
    vocabulary: 'free',
    countdown: 1,
    cloudSeconds: 8,
    showSkeleton: false,
    mirror: false,
    speechRate: 0.8,
  });
});
