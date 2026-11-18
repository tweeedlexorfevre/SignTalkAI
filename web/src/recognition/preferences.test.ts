import { expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences';
it('does not apply malformed or unsupported recognition preferences', () => {
  for (const raw of [
    null,
    'null',
    '{',
    '[]',
    '{"signLanguage":"krsl","showSkeleton":"false","mirror":3,"speechRate":100}',
  ])
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
});
it('restores supported settings without accepting arbitrary stored keys', () => {
  expect(
    parsePreferences(
      '{"signLanguage":"bukva","engine":"cloud","showSkeleton":false,"mirror":false,"speechRate":0.8,"secret":"ignored"}',
    ),
  ).toEqual({
    signLanguage: 'bukva',
    showSkeleton: false,
    mirror: false,
    speechRate: 0.8,
  });
});
