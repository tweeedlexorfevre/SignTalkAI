import { expect, it } from 'vitest';
import { ConversationSession } from './session';
import { phrasesFor, readFavorites } from './phrases';
it('keeps both sides separate and retains drafts through repeated reads until explicitly cleared', () => {
  const session = new ConversationSession();
  session.setDraft('Вопрос');
  session.setReply('Ответ');
  session.send('me', 'Когда сдавать работу?', 'ru');
  session.send('partner', 'В пятницу', 'ru', 'speech');
  expect(session.getSnapshot().messages.map((m) => m.role)).toEqual(['me', 'partner']);
  expect(session.getSnapshot().draft).toBe('Вопрос');
  expect(session.getSnapshot().reply).toBe('Ответ');
  session.send('me', '  ', 'ru');
  expect(session.getSnapshot().messages).toHaveLength(2);
  session.clear();
  expect(session.getSnapshot()).toMatchObject({ draft: '', reply: '', messages: [] });
});
it('provides college phrases for all scenes in each language and bounds saved phrases', () => {
  for (const scene of ['lesson', 'office', 'peers'] as const) {
    expect(phrasesFor(scene, 'ru')).toHaveLength(6);
    expect(phrasesFor(scene, 'kk')).toHaveLength(6);
  }
  expect(readFavorites('not json')).toEqual([]);
  expect(readFavorites('[1,null,"","Моя фраза"]')).toEqual(['Моя фраза']);
  expect(
    readFavorites(JSON.stringify(Array.from({ length: 20 }, (_, i) => `Фраза ${i}`))),
  ).toHaveLength(12);
});
